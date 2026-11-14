import { createRootPosition, positionBattle, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import { searchOptions } from '../../search/options.ts';
import { ForcedWinProver, type ProofPlan } from '../prover.ts';
import { orderByOdds, orderByRanking, type Side } from '../prover-order.ts';
import { WinMeter } from './budget.ts';
import { luckUnder, type Chooser } from './luck.ts';
import { awaitsReplacement } from './luck-path.ts';
import { greedyReplacements } from './replacement.ts';
import type { WinPathsRequest, WinStep } from './types.ts';

/**
 * Round 89 (#130, step 1): a stronger play. The side that lost may pick any own choice at the turn; the opponent answers with its best
 * reply (every legal choice). The prover (endgame/prover.ts, `floor: 0` and `plan: true`) proves each own choice in the ranking's order
 * with the turns asked as its depth, the share of the dice that win whatever the opponent answers (the mass, a lower bound under the
 * class model, with the caveats of the prover: crits stay outside it and doubles prove over sampled rolls). The best choice's mass is the
 * step's `chance`, the played choice's `played`. A choice is stronger when its mass beats the played one's and is above 0.
 *
 * The line is a witness: the likeliest dice under which the proof's choices win (the own choice that proved each position and the reply
 * that gave its minimum, a replacement the simulator's greedy resolution picks), searched as the luck step searches (luck.ts). A
 * position the dice reach that the proof did not (a roll a little off the proof's own draw) is proved again from there with the turns
 * that are left. The line ends in the win, so ▶ Play shows a game the proof says is won in that share of the dice.
 *
 * Singles and doubles share this path; no species or move name enters it.
 */

const optionsOf = (request: WinPathsRequest) => ({ tera: request.tera, sleepClause: request.sleepClause, ruleset: request.ruleset });

/** The chooser that follows a proof: the root's best plan, then the plan of each position the dice reach (proved with the turns that are left). */
function planChooser(side: Side, request: WinPathsRequest, rootPlan: ProofPlan, meter: WinMeter, provers: Map<number, ForcedWinProver>, turns: number): (root: SimPosition) => Chooser {
  const proverFor = (left: number): ForcedWinProver => {
    let prover = provers.get(left);
    if (!prover) {
      prover = new ForcedWinProver(side, optionsOf(request), { states: meter.cap.cells, cells: meter.cap.cells, depth: left }, { states: 0, cells: 0 }, { floor: 0, plan: true });
      provers.set(left, prover);
    }
    return prover;
  };
  const labelled = (position: SimPosition, who: Side, choice: string): ChoiceOption =>
    searchOptions(position, who, { tera: request.tera, sleepClause: request.sleepClause }).find(option => option.choice === choice) ?? { choice, label: choice };
  return () => ({
    at: (position, node) => {
      const pair = (own: ChoiceOption, reply: ChoiceOption) => (side === 'p1' ? { p1: own, p2: reply } : { p1: reply, p2: own });
      if (awaitsReplacement(node.start)) {
        const picks = greedyReplacements(node.start);
        const pick = (who: Side): ChoiceOption => (picks[who] ? labelled(position, who, picks[who]!) : labelled(position, who, 'wait'));
        return { p1: pick('p1'), p2: pick('p2') };
      }
      if (node.atRoot) return pair(rootPlan.own, rootPlan.reply);
      const plan = proverFor(turns - node.turnsDone).planAt(position, 0).plan;
      return plan ? pair(plan.own, plan.reply) : null;
    },
  });
}

/** The candidates of the turn in the ranking's order (the kill odds when the request names none), the played choice last when it is no option. */
function candidatesOf(root: SimPosition, side: Side, request: WinPathsRequest): ChoiceOption[] {
  const own = searchOptions(root, side, { tera: request.tera, sleepClause: request.sleepClause });
  const order = request.rootOrder ?? [];
  return order.length > 0 ? orderByRanking(own, order) : orderByOdds(positionBattle(root), side, own);
}

/** The best candidate's mass and plan, the played choice's mass, and whether a cap cut the proof: every candidate in the ranking's order, one proof each. */
function proveCandidates(root: SimPosition, prover: ForcedWinProver, request: WinPathsRequest): { best: { mass: number; plan: ProofPlan } | null; played?: number } {
  let best: { mass: number; plan: ProofPlan } | null = null;
  let played: number | undefined;
  for (const candidate of candidatesOf(root, request.side, request)) {
    if (prover.capped) break;
    const proof = prover.candidateProof(root, candidate);
    if (candidate.choice === request.played) played = proof.proven.mass;
    if (proof.plan && proof.proven.mass > (best?.mass ?? 0)) best = { mass: proof.proven.mass, plan: proof.plan };
  }
  return { best, played };
}

export function strongerStep(serialized: string, request: WinPathsRequest, meter = new WinMeter(request.budget)): WinStep {
  const side = request.side;
  const turns = request.turns ?? 3;
  const root = createRootPosition(serialized, request.ruleset);
  const done = (step: Omit<WinStep, 'kind' | 'spent'>): WinStep => ({ kind: 'stronger', ...step, spent: meter.spent });
  if (positionBattle(root).ended) return done({ status: 'none' });
  const prover = new ForcedWinProver(side, optionsOf(request), { states: meter.cap.cells, cells: meter.cap.cells, depth: turns }, { states: 0, cells: 0 }, { floor: 0, plan: true });
  const provers = new Map<number, ForcedWinProver>([[turns, prover]]);
  const { best, played } = proveCandidates(root, prover, request);
  meter.cells = prover.cells;
  const beside = played === undefined ? {} : { played };
  if (!best || best.mass <= (played ?? 0)) return done({ status: prover.capped ? 'stopped' : 'none', ...(best ? { chance: best.mass } : {}), ...beside });
  const witness = luckUnder(serialized, { ...request, floor: 0 }, meter, planChooser(side, request, best.plan, meter, provers, turns));
  meter.cells = [...provers.values()].reduce((sum, item) => sum + item.cells, 0);
  return done({ status: 'found', chance: best.mass, ...beside, ...(witness.line ? { line: witness.line } : {}) });
}

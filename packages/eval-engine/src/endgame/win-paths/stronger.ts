import { createRootPosition, legalChoices, positionBattle, type ChoiceOption, type SimPosition } from '../../forward-model.ts';
import { searchOptions } from '../../search/options.ts';
import { ForcedWinProver, type ProofPlan } from '../prover.ts';
import { orderByOdds, orderByRanking, type Side } from '../prover-order.ts';
import { WinMeter } from './budget.ts';
import { luckUnder, type Chooser } from './luck.ts';
import { awaitsReplacement } from './luck-path.ts';
import { greedyReplacements } from './replacement.ts';
import type { WinPathsRequest, WinStep } from './types.ts';

// Each own choice is proved in ranking order, the best mass is the chance; the line is a witness, re-proved if missed.

const optionsOf = (request: WinPathsRequest) => ({ tera: request.tera, sleepClause: request.sleepClause, ruleset: request.ruleset });

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

function candidatesOf(root: SimPosition, side: Side, request: WinPathsRequest): ChoiceOption[] {
  const own = searchOptions(root, side, { tera: request.tera, sleepClause: request.sleepClause });
  const order = request.rootOrder ?? [];
  const ranked = order.length > 0 ? orderByRanking(own, order) : orderByOdds(positionBattle(root), side, own);
  const choice = request.proof?.choice;
  if (!choice) return ranked;
  const named = own.find(option => option.choice === choice) ?? legalChoices(root, side, { tera: request.tera }).find(option => option.choice === choice);
  return named ? [named, ...ranked.filter(option => option.choice !== choice)] : ranked;
}

function proveCandidates(root: SimPosition, prover: ForcedWinProver, request: WinPathsRequest): { best: { mass: number; plan: ProofPlan } | null; played?: number } {
  let best: { mass: number; plan: ProofPlan } | null = null;
  let played: number | undefined;
  for (const candidate of candidatesOf(root, request.side, request)) {
    if (prover.capped) break;
    const proof = prover.candidateProof(root, candidate);
    if (candidate.choice === request.played && !prover.capped) played = proof.proven.mass;
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
  if (!best || (!request.proof && best.mass <= (played ?? 0))) return done({ status: prover.capped ? 'stopped' : 'none', ...(best ? { chance: best.mass } : {}), ...beside });
  const witness = luckUnder(serialized, { ...request, floor: 0 }, meter, planChooser(side, request, best.plan, meter, provers, turns));
  meter.cells = [...provers.values()].reduce((sum, item) => sum + item.cells, 0);
  return done({ status: 'found', chance: best.mass, ...beside, ...(witness.line ? { line: witness.line } : {}) });
}

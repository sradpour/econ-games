// Game catalogue: descriptions, instructor settings and comprehension checks.
import { DEFAULTS, GAME_LABELS, normalizeConfig, variableCost, marginalProduct } from './engine.js';

export { GAME_LABELS, normalizeConfig };
export const MARKETS = ['competitive', 'monopolistic', 'oligopoly', 'monopoly'];

// Production stories: same economics, different names. Instructors can edit every label and number.
export const STORIES = {
  bakery: { business: 'bakery', product: 'loaf', product_plural: 'loaves', material_name: 'flour and ingredients', material_unit: 'lb', material_qty: 0.25, material_price: 2 },
  pizza: { business: 'pizzeria', product: 'pizza', product_plural: 'pizzas', material_name: 'dough and toppings', material_unit: 'lb', material_qty: 0.25, material_price: 2 },
  coffee: { business: 'coffee cart', product: 'cup', product_plural: 'cups', material_name: 'coffee beans and milk', material_unit: 'serving', material_qty: 1, material_price: 0.5 },
};
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const a_an = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
export const rentOf = (c) => c.fixed_cost * (1 - c.avoidable_share);
export const equipmentOf = (c) => c.fixed_cost * c.avoidable_share;
export function productionLines(c) {
  return [
    `Making ${c.product_plural} takes labor at ${money2(c.wage)} per hour, plus ${c.material_name}: ${c.material_qty} ${c.material_unit} per ${c.product} at ${money2(c.material_price)} per ${c.material_unit}.`,
    `The first hour of labor makes ${c.base_productivity} ${c.product_plural}. Each extra hour makes fewer than the one before (your kitchen gets crowded), so every extra ${c.product} costs more than the last.`,
    `Rent is ${money2(rentOf(c))} per round no matter what. Equipment and utilities cost ${money2(equipmentOf(c))} per round, which you save if you sit a round out.`,
  ];
}

export const GAME_INFO = {
  competitive: {
    short: 'Many firms sell an identical product. Each round you post a price and choose how much to produce.',
    rules: (c) => [
      `You run one of many ${c.business === 'bakery' ? 'bakeries' : c.business + 's'} in town, all selling the same ${c.product}. Buyers go to the cheapest sellers first.`,
      `Each round choose a price and how many ${c.product_plural} to make. You pay for everything you make, sold or not.`,
      ...productionLines(c),
    ],
  },
  monopolistic: {
    short: 'Many firms with slightly different products. Set price and quantity, and spend on branding to win loyal customers.',
    rules: (c) => [
      `You run one of many ${c.business}s in town. Each makes its own slightly different ${c.product}.`,
      `Each round choose a price, how many ${c.product_plural} to make, and how much to spend on branding.`,
      'Lower prices attract more customers. Customers who cannot buy from you because you ran out are lost.',
      'Branding costs money now but builds a brand: customers like your product more and care less about price. Brand strength fades by about a third each round unless you keep investing.',
      ...productionLines(c),
    ],
  },
  oligopoly: {
    short: 'A handful of firms with slightly different products compete on price. You produce exactly what customers buy.',
    rules: (c) => [
      `Your ${c.business} competes with a few rivals selling similar ${c.product_plural}.`,
      `Each round you choose only a price. You make exactly as many ${c.product_plural} as customers order.`,
      'If you charge more than your rivals you still sell some, just fewer. Demand also moves a little at random each round.',
      ...productionLines(c),
      'Talking to other teams about prices is not allowed.',
    ],
  },
  monopoly: {
    short: 'You are the only seller. You see the demand curve and choose price and quantity.',
    rules: (c) => [
      `You run the only ${c.business} in town, so the whole demand curve is yours.`,
      `Buyers want Q = ${c.demand_a} − ${c.demand_b} × P ${c.product_plural} at price P.`,
      `Each round choose a price and how many ${c.product_plural} to make. You sell the smaller of what you make and what buyers want at your price.`,
      ...productionLines(c),
    ],
  },
  pd_live: {
    short: 'You are paired with an anonymous classmate and choose to cooperate or defect, round after round.',
    rules: (c) => [
      'You are paired with a classmate. Neither of you knows who the other is.',
      'Each round you both choose Cooperate or Defect at the same time.',
      `Both cooperate: ${c.payoff_R} each. Both defect: ${c.payoff_P} each. If one defects and the other cooperates, the defector gets ${c.payoff_T} and the cooperator ${c.payoff_S}.`,
      `A match lasts between ${c.min_rounds} and ${c.max_rounds} rounds. Nobody knows which round is the last. Then you get a new partner (${c.matches} matches in total).`,
    ],
  },
  pd_tournament: {
    short: "Describe a prisoner's dilemma strategy in plain English, test it, and enter it in a round-robin tournament.",
    rules: (c) => [
      'With your team, describe a strategy in plain English. The AI translator turns it into a small program.',
      'Check the plain-English explanation and the test matches to make sure it does exactly what you meant.',
      `In the tournament every strategy plays every other strategy. Each match lasts ${c.min_rounds}–${c.max_rounds} rounds and strategies cannot know which round is last.`,
      `Payoffs per round: both cooperate ${c.payoff_R} each, both defect ${c.payoff_P} each, defect vs cooperate ${c.payoff_T} vs ${c.payoff_S}.`,
    ],
  },
  public_goods: {
    short: 'In anonymous groups, decide how much of your tokens to put into a shared pot that benefits everyone.',
    rules: (c) => [
      `Each round you get ${c.endowment} tokens and decide how many to put into your group's pot. You keep the rest.`,
      `Everyone in your group, including you, earns ${c.mpcr} tokens for every token in the pot.`,
      c.matching === 'partners' ? 'Your group stays the same all game.' : 'Groups are reshuffled every round.',
      c.rounds_punish > 0
        ? `In the last ${c.rounds_punish} rounds you see what each groupmate put in and can assign deduction points: each point costs you ${c.punish_cost} and costs them ${c.punish_impact}.`
        : 'Contributions are anonymous.',
    ],
  },
  ultimatum: {
    short: 'Split a pot of money with an anonymous partner. In the ultimatum version they can reject your offer.',
    rules: (c) => c.variant === 'dictator' ? [
      `Each round you are paired at random. One of you, the proposer, splits $${c.pie}.`,
      'The other person simply receives whatever the proposer offers.',
      'Roles are assigned at random each round. Partners are anonymous.',
    ] : [
      `Each round you are paired at random. The proposer offers part of $${c.pie} to the responder.`,
      'If the responder accepts, both get the proposed split. If they reject, both get nothing.',
      'Roles are assigned at random each round. Partners are anonymous.',
    ],
  },
};

const money2 = (v) => { const n = Number(v); return `$${n.toLocaleString(undefined, Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const pctTxt = (v) => `${Math.round(Number(v) * 100)}%`;

// ---------------------------------------------------------------------------
// Settings shown on the "new game" form

const S = (key, label, type, help, extra = {}) => ({ key, label, type, help, ...extra });
const teamSettings = [
  S('team_mode', 'Play as', 'select', 'Teams share one firm; a rotating captain submits each round.', { options: [['individual', 'Individuals'], ['teams', 'Teams']] }),
  S('team_size', 'Max team size', 'number', 'Students create, join and name their own teams.', { min: 1, max: 8, step: 1, showIf: (c) => c.team_mode === 'teams' }),
];
const marketTiming = [
  S('rounds', 'Rounds', 'number', '', { min: 1, max: 50, step: 1 }),
  S('round_seconds', 'Seconds per round', 'number', '0 = no timer (you end each round).', { min: 0, max: 1800, step: 15 }),
  S('auto_advance', 'End round early when everyone has submitted', 'bool', ''),
  S('missed', 'If a firm misses the deadline', 'select', '', { options: [['sit_out', 'It sits the round out'], ['keep_last', 'It keeps its last decision']] }),
];
const costs = [
  S('difficulty', 'Difficulty', 'select', 'Hard: students see only input prices and the production table, and build their own cost table on a worksheet.',
    { options: [['normal', 'Normal: show the full cost table'], ['hard', 'Hard: students work out costs themselves']] }),
  S('story', 'Business', 'select', 'Fills in the names below; you can edit them.', { options: [['bakery', 'Bakery (loaves)'], ['pizza', 'Pizzeria (pizzas)'], ['coffee', 'Coffee cart (cups)']] }),
  S('business', 'Business name', 'text', ''), S('product', 'Product (one)', 'text', ''), S('product_plural', 'Product (many)', 'text', ''),
  S('material_name', 'Raw material', 'text', ''), S('material_unit', 'Raw material unit', 'text', ''),
  S('material_qty', 'Raw material per unit of product', 'number', '', { min: 0, step: 0.05 }),
  S('material_price', 'Price per unit of raw material ($)', 'number', '', { min: 0, step: 0.05 }),
  S('wage', 'Wage per labor hour ($)', 'number', '', { min: 0, step: 0.5 }),
  S('base_productivity', 'Output from the first hour of labor', 'number', '', { min: 0.1, step: 0.5 }),
  S('productivity_half', 'Output level where an extra hour adds half as much', 'number', 'Smaller = productivity falls faster = steeper marginal cost.', { min: 1, step: 1 }),
  S('fixed_cost', 'Fixed cost per round ($): rent + equipment', 'number', '', { min: 0, step: 10 }),
  S('avoidable_share', 'Share of fixed cost that is equipment & utilities', 'number', '0 to 1. Saved by sitting a round out; the rest is rent.', { min: 0, max: 1, step: 0.05 }),
];
const display = [
  S('leaderboard', 'Leaderboard', 'select', '', { options: [['live', 'Show after every round'], ['end', 'Show at the end'], ['never', 'Never show students']] }),
  S('show_prices', "Show everyone's prices after each round", 'bool', ''),
  S('reveal_at_end', "Reveal everyone's decisions when the game ends", 'bool', ''),
];

export const SETTINGS = {
  competitive: [...teamSettings, ...marketTiming, ...costs,
    S('demand_a', 'Demand intercept (per firm)', 'number', 'Market demand = number of firms × (a − b × P).', { min: 1, step: 5 }),
    S('demand_b', 'Demand slope (per firm)', 'number', '', { min: 0.1, step: 0.5 }),
    S('price_noise', 'Price perception noise', 'number', 'Small random mixing of near-equal prices (0.02 = ±2%).', { min: 0, max: 0.2, step: 0.01 }),
    S('max_price', 'Highest allowed price ($)', 'number', '', { min: 1 }), S('max_quantity', 'Highest allowed quantity', 'number', '', { min: 1 }),
    ...display],
  monopolistic: [...teamSettings, ...marketTiming, ...costs,
    S('buyers_per_firm', 'Buyers per firm', 'number', '', { min: 10, step: 10 }),
    S('appeal', 'Product appeal', 'number', 'Higher = more buyers prefer buying over not buying.', { step: 0.1 }),
    S('price_sensitivity', 'Price sensitivity', 'number', 'Higher = products are closer substitutes.', { min: 0.01, step: 0.05 }),
    S('outside_weight', 'Pull of not buying', 'number', '', { min: 0, step: 0.05 }),
    S('demand_noise', 'Random demand shocks', 'number', '0.1 ≈ ±10% swings per firm per round.', { min: 0, max: 1, step: 0.05 }),
    S('brand_decay', 'Brand carried to next round', 'number', '0.7 = 70% of brand strength survives each round.', { min: 0, max: 1, step: 0.05 }),
    S('brand_appeal', 'Brand effect on appeal', 'number', '', { min: 0, step: 0.1 }),
    S('brand_loyalty', 'Brand effect on price sensitivity', 'number', 'Maximum cut in price sensitivity (0.5 = halves it).', { min: 0, max: 0.95, step: 0.05 }),
    S('brand_scale', 'Brand scale ($)', 'number', 'Spending around this level gives half the maximum effect.', { min: 1, step: 10 }),
    S('max_price', 'Highest allowed price ($)', 'number', '', { min: 1 }), S('max_quantity', 'Highest allowed quantity', 'number', '', { min: 1 }),
    S('max_branding', 'Highest branding spend per round ($)', 'number', '', { min: 0 }),
    ...display],
  oligopoly: [...teamSettings, ...marketTiming, ...costs,
    S('buyers_per_firm', 'Buyers per firm', 'number', '', { min: 10, step: 10 }),
    S('appeal', 'Product appeal', 'number', '', { step: 0.1 }),
    S('price_sensitivity', 'Price sensitivity', 'number', 'Higher = products are closer substitutes, so undercutting pays more.', { min: 0.01, step: 0.05 }),
    S('outside_weight', 'Pull of not buying', 'number', '', { min: 0, step: 0.05 }),
    S('demand_noise', 'Random demand shocks', 'number', '0.1 ≈ ±10% swings per firm per round.', { min: 0, max: 1, step: 0.05 }),
    S('max_price', 'Highest allowed price ($)', 'number', '', { min: 1 }),
    ...display],
  monopoly: [...teamSettings, ...marketTiming, ...costs,
    S('demand_a', 'Demand intercept a', 'number', 'Demand: Q = a − b × P (shown to students).', { min: 1, step: 5 }),
    S('demand_b', 'Demand slope b', 'number', '', { min: 0.1, step: 0.5 }),
    S('demand_noise', 'Random demand shocks', 'number', '0 = demand is exactly as shown.', { min: 0, max: 0.5, step: 0.05 }),
    S('max_price', 'Highest allowed price ($)', 'number', '', { min: 1 }), S('max_quantity', 'Highest allowed quantity', 'number', '', { min: 1 }),
    ...display],
  pd_live: [...teamSettings,
    S('matches', 'Matches (new random partner each)', 'number', '', { min: 1, max: 20, step: 1 }),
    S('min_rounds', 'Shortest match (rounds)', 'number', 'Each match has a hidden random length in this range.', { min: 1, step: 1 }),
    S('max_rounds', 'Longest match (rounds)', 'number', '', { min: 1, step: 1 }),
    S('round_seconds', 'Seconds per round', 'number', '0 = no timer.', { min: 0, step: 5 }),
    S('auto_advance', 'End round early when everyone has chosen', 'bool', ''),
    S('payoff_R', 'Both cooperate (each)', 'number', '', { step: 1 }), S('payoff_P', 'Both defect (each)', 'number', '', { step: 1 }),
    S('payoff_T', 'Defect vs cooperate: defector', 'number', '', { step: 1 }), S('payoff_S', 'Defect vs cooperate: cooperator', 'number', '', { step: 1 }),
    S('leaderboard', 'Leaderboard', 'select', '', { options: [['end', 'Show at the end'], ['live', 'Show after every round'], ['never', 'Never show students']] })],
  pd_tournament: [...teamSettings,
    S('min_rounds', 'Shortest match (rounds)', 'number', '', { min: 1, step: 1 }), S('max_rounds', 'Longest match (rounds)', 'number', '', { min: 1, step: 1 }),
    S('repeats', 'Times each pair plays', 'number', 'Each repetition uses a new random match length.', { min: 1, max: 10, step: 1 }),
    S('include_house', 'Add house strategies (Tit for Tat, Always Defect…) as extra entrants', 'bool', ''),
    S('payoff_R', 'Both cooperate (each)', 'number', '', { step: 1 }), S('payoff_P', 'Both defect (each)', 'number', '', { step: 1 }),
    S('payoff_T', 'Defect vs cooperate: defector', 'number', '', { step: 1 }), S('payoff_S', 'Defect vs cooperate: cooperator', 'number', '', { step: 1 })],
  public_goods: [
    S('group_size', 'Group size', 'number', 'Leftover students are spread across groups.', { min: 2, max: 10, step: 1 }),
    S('matching', 'Groups', 'select', '', { options: [['partners', 'Partners: same group all game'], ['strangers', 'Strangers: reshuffled every round']] }),
    S('endowment', 'Tokens per round', 'number', '', { min: 1, step: 1 }),
    S('mpcr', 'Return per token in the pot', 'number', 'Each member earns this × group total. Classic value 0.4 (×1.6 split 4 ways).', { min: 0.05, max: 1, step: 0.05 }),
    S('rounds_no_punish', 'Rounds without punishment', 'number', '', { min: 0, step: 1 }),
    S('rounds_punish', 'Rounds with punishment', 'number', 'Played after the rounds without punishment.', { min: 0, step: 1 }),
    S('contribute_seconds', 'Seconds to contribute', 'number', '', { min: 0, step: 5 }),
    S('punish_seconds', 'Seconds to punish', 'number', '', { min: 0, step: 5 }),
    S('punish_cost', 'Cost per point to the punisher', 'number', '', { min: 0, step: 0.5 }),
    S('punish_impact', 'Deduction per point received', 'number', '', { min: 0, step: 0.5 }),
    S('max_punish_points', 'Max points a player can assign per round', 'number', '', { min: 0, step: 1 }),
    S('auto_advance', 'End stage early when everyone has decided', 'bool', ''),
    S('leaderboard', 'Leaderboard', 'select', '', { options: [['end', 'Show at the end'], ['live', 'Show after every round'], ['never', 'Never show students']] })],
  ultimatum: [
    S('variant', 'Version', 'select', 'Run both to compare: the dictator game removes the threat of rejection.', { options: [['ultimatum', 'Ultimatum (responder can reject)'], ['dictator', 'Dictator (no rejection)']] }),
    S('pie', 'Amount to split ($)', 'number', '', { min: 1, step: 1 }),
    S('rounds', 'Rounds', 'number', 'New random partner and role each round.', { min: 1, step: 1 }),
    S('offer_seconds', 'Seconds to offer', 'number', '', { min: 0, step: 5 }),
    S('respond_seconds', 'Seconds to respond', 'number', '', { min: 0, step: 5, showIf: (c) => c.variant !== 'dictator' }),
    S('auto_advance', 'End stage early when everyone has decided', 'bool', ''),
    S('leaderboard', 'Leaderboard', 'select', '', { options: [['end', 'Show at the end'], ['live', 'Show after every round'], ['never', 'Never show students']] })],
};

export const defaultsFor = (gameType) => ({ ...DEFAULTS[gameType] });

// ---------------------------------------------------------------------------
// Comprehension checks: every answer is computed from this game's settings.

const Q = (q, answer, wrong) => ({ q, answer: String(answer), options: shuffle([String(answer), ...wrong.map(String)]) });
function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
const m = (v) => money2(Math.round(v * 100) / 100);
const uniq = (answer, list) => [...new Set(list.map(String))].filter((x) => x !== String(answer)).slice(0, 3);

export function quizFor(gameType, cfg) {
  const c = normalizeConfig(gameType, cfg);
  const sitOut = c.fixed_cost * (1 - c.avoidable_share);
  const mcQ = () => {
    if (!c.wage) {
      const mc50 = c.mc_intercept + c.mc_slope * 50;
      return Q('What does it cost you to make the 50th unit (its marginal cost)?', m(mc50), uniq(m(mc50), [m(c.mc_intercept), m(variableCost(50, c)), m(mc50 * 2)]));
    }
    const q = Math.round(4 * c.productivity_half);
    const mp = marginalProduct(q, c);
    const mat = c.material_qty * c.material_price;
    const mc = c.wage / mp + mat;
    const mpTxt = Math.round(mp * 100) / 100;
    return Q(`You are making ${q} ${c.product_plural}. One more hour of labor would add ${mpTxt} ${c.product_plural}. Labor costs ${money2(c.wage)} an hour and ${c.material_name} cost ${money2(mat)} per ${c.product}. What does one more ${c.product} cost you?`,
      m(mc), uniq(m(mc), [m(c.wage / mp), m(c.wage), m(c.wage * mp + mat), m(mat)]));
  };
  const sitQ = () => Q(c.wage ? 'If you sit a round out, what do you still pay that round?' : 'If you sit a round out, what do you pay that round?', m(sitOut),
    uniq(m(sitOut), [m(0), m(c.fixed_cost), m(c.fixed_cost * 2)]));
  const mpQ = () => Q(`Why does each extra ${c.product} cost more to make than the last?`, 'Each extra hour of labor adds fewer units than the one before',
    ['The wage goes up every hour', `The price of ${c.material_name} rises as you buy more`, 'Rent goes up when you produce more']);
  switch (gameType) {
    case 'competitive':
      return [mcQ(),
        Q(`You make 80 ${c.product_plural} but price above what buyers will pay. What happens?`, 'You sell nothing and still pay for all 80',
          ['Unsold units carry over to next round', 'You only pay for the units you sell', 'The game sells them at the market price for you']),
        sitQ(), mpQ()];
    case 'monopolistic':
      return [mcQ(),
        Q('What does spending on branding do?', 'Costs money now; builds a brand that makes customers like you more and care less about price, fading over time',
          ['Lowers your marginal cost', 'Guarantees you sell everything you produce', 'Has an effect only in the round you spend it']),
        Q('You produce 50 units but 70 customers want your product. How many do you sell?', '50', ['70', '60', '0'])];
    case 'oligopoly':
      return [
        Q('How many units does your firm produce each round?', 'Exactly as many as customers buy at your price',
          ['A quantity you choose', 'The same as every other firm', 'As many as you can afford']),
        Q('Your price is a bit higher than your rivals\'. What happens?', 'You still sell some, but fewer than they do',
          ['You sell nothing', 'You sell more because you look premium', 'Your price is lowered automatically']),
        mcQ()];
    case 'monopoly': {
      const p = Math.round(c.demand_a / c.demand_b / 2);
      const q = Math.max(0, c.demand_a - c.demand_b * p);
      return [
        Q(`Demand is Q = ${c.demand_a} − ${c.demand_b} × P. At a price of $${p}, how many units can you sell?`, q,
          uniq(q, [c.demand_a, q * 2, Math.round(q / 2), c.demand_a - p])),
        Q('You set a price and produce more than buyers want at that price. What happens to the extra units?', 'You pay for them but they go unsold',
          ['They sell at a lower price', 'They carry over to next round', 'You are not charged for them']),
        mcQ()];
    }
    case 'pd_live':
      return [
        Q('You cooperate and your partner defects. How many points do you get?', c.payoff_S, uniq(c.payoff_S, [c.payoff_R, c.payoff_T, c.payoff_P, c.payoff_S + 2])),
        Q('You both defect. How many points do you each get?', c.payoff_P, uniq(c.payoff_P, [c.payoff_R, c.payoff_T, c.payoff_S, c.payoff_P + 1])),
        Q('How long does a match with one partner last?', `Between ${c.min_rounds} and ${c.max_rounds} rounds, and you won't know when it ends`,
          [`Exactly ${c.max_rounds} rounds`, 'Until someone defects', 'You choose when to stop'])];
    case 'pd_tournament':
      return [
        Q('What can your strategy look at when it decides?', 'Its own and its opponent\'s moves so far in the current match',
          ['The opponent\'s name', 'How many rounds are left', 'The opponent\'s program']),
        Q('Both strategies cooperate in a round. How many points does each get?', c.payoff_R, uniq(c.payoff_R, [c.payoff_T, c.payoff_P, c.payoff_S, c.payoff_R + 2])),
        Q('Who will your strategy play against?', 'Every other team\'s strategy', ['Only Tit for Tat', 'One random team', 'Itself only'])];
    case 'public_goods': {
      const mine = Math.round(c.endowment / 2);
      const total = mine * Math.max(2, c.group_size);
      const earn = c.endowment - mine + c.mpcr * total;
      const qs = [
        Q(`You put ${mine} of your ${c.endowment} tokens in the pot and the group total (including yours) is ${total}. What do you earn?`,
          num2(earn), uniq(num2(earn), [num2(c.endowment - mine), num2(c.mpcr * total), num2(c.endowment + c.mpcr * total), num2(total)])),
        Q('Who knows how much you put in?', 'Nobody knows it was you', ['Everyone sees your name', 'Only the instructor during the game', 'Your groupmates see your name']),
      ];
      if (c.rounds_punish > 0) {
        qs.push(Q(`You give a groupmate 2 deduction points. What does it cost you and them?`,
          `You lose ${num2(2 * c.punish_cost)}, they lose ${num2(2 * c.punish_impact)}`,
          [`You lose nothing, they lose ${num2(2 * c.punish_impact)}`, `You both lose ${num2(2 * c.punish_cost)}`, `You gain ${num2(2 * c.punish_impact)}`]));
      }
      return qs;
    }
    case 'ultimatum': {
      const offer = Math.max(1, Math.round(c.pie * 0.3));
      if (c.variant === 'dictator') {
        return [
          Q(`As proposer you keep $${c.pie - offer} of $${c.pie}. What does the other person get?`, `$${offer}`, uniq(`$${offer}`, [`$0`, `$${c.pie}`, `$${c.pie - offer}`])),
          Q('Can the other person reject your offer?', 'No, they receive whatever you give', ['Yes, and then both get nothing', 'Yes, and then they get half', 'Only in the last round'])];
      }
      return [
        Q(`The proposer offers $${offer} of $${c.pie} and the responder rejects. What do they get?`, 'Both get $0',
          [`Proposer $${c.pie - offer}, responder $0`, `Both get $${c.pie / 2}`, `Proposer $${c.pie}, responder $0`]),
        Q(`The responder accepts an offer of $${offer}. What does the proposer get?`, `$${c.pie - offer}`, uniq(`$${c.pie - offer}`, [`$${offer}`, `$${c.pie}`, `$0`])),
        Q('Who is your partner?', 'A random, anonymous classmate, new each round', ['Your best friend', 'The same person all game', 'The instructor'])];
    }
    default: return [];
  }
}
const num2 = (v) => String(Math.round(v * 100) / 100);

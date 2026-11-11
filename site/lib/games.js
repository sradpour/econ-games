// Game catalogue: descriptions, instructor settings and comprehension checks.
import { DEFAULTS, GAME_LABELS, normalizeConfig, variableCost, marginalProduct, fixedMarketPrice, costsModel } from './engine.js';

export { GAME_LABELS, normalizeConfig };
export const MARKETS = ['competitive', 'monopolistic', 'oligopoly', 'monopoly'];

// Production stories: same economics, different names. Instructors can edit every label and number.
export const STORIES = {
  bakery: { business: 'bakery', product: 'loaf', product_plural: 'loaves', material_name: 'flour and ingredients', material_unit: 'lb', material_qty: 0.25, material_price: 2 },
  pizza: { business: 'pizzeria', product: 'pizza', product_plural: 'pizzas', material_name: 'dough and toppings', material_unit: 'lb', material_qty: 0.25, material_price: 2 },
  coffee: { business: 'coffee cart', product: 'cup', product_plural: 'cups', material_name: 'coffee beans and milk', material_unit: 'serving', material_qty: 1, material_price: 0.5 },
};
// Stories for the costs game (same numbers, different words).
export const COST_STORIES = {
  bakery: { business: 'bakery', product: 'loaf', product_plural: 'loaves', worker: 'baker', worker_plural: 'bakers',
    material_name: 'flour', material_unit: 'lb', material_qty: 0.5, material_price: 1.2, extras_name: 'yeast, salt and sugar',
    package_name: 'paper bag', energy_name: 'gas for the oven', lease_name: 'mixer and display case', sublet_name: 'a caterer', sunk_name: 'oven' },
  pizza: { business: 'pizzeria', product: 'pizza', product_plural: 'pizzas', worker: 'cook', worker_plural: 'cooks',
    material_name: 'cheese', material_unit: 'lb', material_qty: 0.25, material_price: 2.4, extras_name: 'dough, sauce and toppings',
    package_name: 'pizza box', energy_name: 'wood for the oven', lease_name: 'dough mixer and freezer', sublet_name: 'a cooking school', sunk_name: 'pizza oven' },
  coffee: { business: 'coffee cart', product: 'cup', product_plural: 'cups', worker: 'barista', worker_plural: 'baristas',
    material_name: 'coffee beans', material_unit: 'oz', material_qty: 0.5, material_price: 1.2, extras_name: 'milk and sugar',
    package_name: 'cup and lid', energy_name: 'electricity for the machines', lease_name: 'grinder and fridge', sublet_name: 'a juice vendor', sunk_name: 'espresso machine' },
};

// The costs game's bills. Each one is sorted twice in step 1: does it still cost you if you close
// (yes / no / already paid), and is it fixed or variable? The easy version only has fixed and variable costs.
export const CLOSE_CHOICES = [['yes', 'Yes'], ['no', 'No'], ['sunk', 'Already paid']];
export const FV_CHOICES = [['fixed', 'Fixed'], ['variable', 'Variable']];
export function costBills(c) {
  const P = c.period;
  const easy = c.level === 'easy';
  const one = /^[aeiou]/i.test(c.package_name) ? 'an' : 'a';
  const r2 = (v) => Math.round(v * 100) / 100;
  const all = [
    { id: 'rent', close: 'yes', fv: 'fixed', item: 'Rent', amount: c.rent, per: `per ${P}`,
      text: `Rent: ${money2(c.rent)} per ${P}. You signed a one-year rental agreement.` },
    { id: 'sunk', close: 'sunk', fv: null, item: `${cap(c.sunk_name)} (bought last year)`, amount: c.sunk_cost, per: 'once', skip: easy,
      text: `The ${c.sunk_name} you bought last year for ${money2(c.sunk_cost)}. It can't be returned or resold.` },
    { id: 'lease', close: 'no', fv: 'fixed', item: `Lease: ${c.lease_name}`, amount: c.lease, per: `per ${P}`, skip: easy || !(c.lease > 0),
      text: `Leasing the ${c.lease_name}: ${money2(c.lease)} per ${P}. You can pause the lease on any ${P} you don't open.` },
    { id: 'material', close: 'no', fv: 'variable', item: cap(c.material_name), amount: r2(c.material_qty * c.material_price), per: `per ${c.product}`,
      note: `${c.material_qty} ${c.material_unit} × ${money2(c.material_price)}`,
      text: `${cap(c.material_name)}: each ${c.product} uses ${c.material_qty} ${c.material_unit}, at ${money2(c.material_price)} per ${c.material_unit}.` },
    { id: 'insurance', close: 'yes', fv: 'fixed', item: 'Insurance', amount: c.insurance, per: `per ${P}`,
      text: `Insurance: ${money2(c.insurance)} per ${P}, due whether or not you open.` },
    { id: 'wages', close: 'no', fv: 'variable', item: cap(c.worker_plural), amount: c.wage, per: `per ${c.worker}`,
      text: `${cap(c.worker_plural)}: ${money2(c.wage)} each per ${P}. There is room for up to ${c.output_list.length} (see the production table).` },
    { id: 'extras', close: 'no', fv: 'variable', item: cap(c.extras_name), amount: c.extras_cost, per: `per ${c.product}`, skip: !(c.extras_cost > 0),
      text: `${cap(c.extras_name)}: ${money2(c.extras_cost)} per ${c.product}.` },
    { id: 'ad', close: 'sunk', fv: null, item: 'Newspaper ad (prepaid)', amount: c.ad_cost, per: 'once', skip: easy || !(c.ad_cost > 0),
      text: `An ad in the local paper for this ${P}: ${money2(c.ad_cost)}, already paid, no refunds.` },
    { id: 'package', close: 'no', fv: 'variable', item: cap(c.package_name) + 's', amount: c.package_cost, per: `per ${c.product}`, skip: !(c.package_cost > 0),
      text: `${cap(c.package_name)}s: ${money2(c.package_cost)} each. Every ${c.product} goes in ${one} ${c.package_name}.` },
    { id: 'sublet', close: 'no', fv: 'fixed', item: `Income given up (${c.sublet_name})`, amount: c.sublet, per: `per ${P}`, skip: easy || !(c.sublet > 0),
      text: `${cap(c.sublet_name)} will pay you ${money2(c.sublet)} to use your space on any ${P} you close.` },
    { id: 'energy', close: 'no', fv: 'variable', item: cap(c.energy_name), amount: c.energy_cost, per: `per batch of ${c.batch_size} ${c.product_plural}`, skip: !(c.energy_cost > 0),
      text: `${cap(c.energy_name)}: ${money2(c.energy_cost)} for every batch of ${c.batch_size} ${c.product_plural}.` },
    { id: 'license', close: 'sunk', fv: null, item: 'Business license (this year)', amount: c.license_cost, per: 'once', skip: easy || !(c.license_cost > 0),
      text: `Business license: ${money2(c.license_cost)} for the year, paid in January.` },
    { id: 'card', close: 'no', fv: 'variable', item: 'Card fees', amount: r2(c.card_fee * 100), per: '% of sales', skip: !(c.card_fee > 0),
      text: `Card fees: ${pctTxt(c.card_fee)} of every sale. Every customer pays by card.` },
  ];
  return all.filter((b) => !b.skip);
}

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
      `You run one of many ${c.business === 'bakery' ? 'bakeries' : c.business + 's'} in town, all selling the same ${c.product}.`,
      `Each round choose a price and how many ${c.product_plural} to make. You pay for everything you make, sold or not.`,
      ...(c.market_rule === 'cheapest' ? ['Buyers go to the cheapest sellers first. When those sell out, the remaining buyers move to the next cheapest.'] : [
        c.price_range > 0
          ? `The market price changes from round to round (around ${money2c(fixedMarketPrice(c))} per ${c.product}). You see this round's price before you decide. Your firm is too small to change it: you are a price taker.`
          : `The market price is ${money2c(fixedMarketPrice(c))} per ${c.product}. Your firm is too small to change it: you are a price taker.`,
        `If your price is at or below the market price, you sell everything you make, at your own price. Pricing below it just gives money away.`,
        'If your price is above the market price, buyers go elsewhere and you sell only a small share, less the further above you are.',
      ]),
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
      'With your team, describe a strategy in plain English. An AI translator turns it into something the computer can play.',
      'Check the AI\'s plain-English explanation and the practice matches to make sure it does exactly what you meant.',
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
  commons: {
    short: 'Share a fishing lake with two anonymous classmates. Catch fish now, or leave some so the lake refills.',
    rules: (c) => {
      const n = c.group_size;
      const who = c.variant === 'simple' ? 'Player' : 'Fisher';
      const chat = c.chat === 'off' ? [] : [
        `${c.chat === 'later' ? 'Later in the game, before' : 'Before'} each decision you get ${c.chat_seconds ? `${c.chat_seconds} seconds` : 'time'} to message your group. Names are hidden: you appear as ${who} A, B or C. Your instructor can see who wrote what.`,
      ];
      if (c.variant === 'simple') {
        const pool = c.pool_per_member * n;
        return [
          `You are in a random group of ${n}. Your group shares a pool worth ${money2(pool)}.`,
          `Each round, everyone chooses Extract or Wait at the same time.`,
          `If everyone waits, the pool grows to ${money2(pool * c.multiplier)} and is split equally: ${money2(pool * c.multiplier / n)} each.`,
          `If anyone extracts, the people who extracted split the ${money2(pool)} pool and those who waited get nothing.`,
          c.matching === 'partners' ? `Your group stays the same for all ${c.rounds} rounds.` : `You get a new random group every round (${c.rounds} rounds).`,
          ...chat,
          'If you do not choose in time, you wait.',
        ];
      }
      const cap = c.fish_per_member * n;
      return [
        `You fish a lake with ${n - 1} other people (groups of ${n}). The lake holds up to ${cap} fish and starts full.`,
        `Each season, everyone chooses how many fish to catch, from 0 to ${c.max_catch}. Each fish earns you ${money2(c.fish_price)}.`,
        `The fish left in the lake ${c.growth === 2 ? 'double' : `multiply by ${c.growth}`} before the next season, up to ${cap}. If the lake is emptied, it never recovers.`,
        'If your group asks for more fish than the lake has, the fish are shared in proportion to what each person asked for.',
        `A fishing game lasts between ${c.min_seasons} and ${c.max_seasons} seasons. Nobody knows which season is the last.${c.matches > 1 ? ` Then the lakes are restocked and groups are reshuffled (${c.matches} fishing games in all).` : ''}`,
        c.matching === 'partners' ? 'Your group and lake stay the same for the whole fishing game.' : 'Every season you are sent to a random lake with different people.',
        ...chat,
        'If you do not choose in time, your catch from last season is repeated (0 in your first season).',
      ];
    },
  },
  costs: {
    short: 'Sort a firm\'s bills, build its cost table step by step, and work out its supply curve.',
    rules: (c) => [
      `${c.team_mode === 'teams' ? 'Your team runs' : 'You run'} ${a_an(c.business)} ${c.business} in a competitive market: you take the price as given and sell every ${c.product} you make at that price.`,
      `Your job: decide how many ${c.worker_plural} to hire, and so how many ${c.product_plural} to make, at each possible price from ${money2(c.price_list[0])} to ${money2(c.price_list[c.price_list.length - 1])}. That list is your supply schedule.`,
      `You get your ${c.business}'s bills for one ${c.period} and a production table. ${c.level === 'easy' ? 'Each bill is either a fixed or a variable cost.' : 'Some bills matter for that decision and some don\'t.'} A five-step worksheet walks you through it${c.checks === 'on' ? ', and you can check each step' : ''}. Every table can be copied into Excel, and you can paste numbers back in from Excel.`,
      ...(c.team_mode === 'teams' ? ['Anyone on your team can type in the worksheet. Changes are saved for the whole team.'] : []),
      'Scoring: at each price, how close your profit comes to the best possible (0% = the worst choice at that price, 100% = the best). Your score is the average over all prices.',
      c.pace === 'self'
        ? (c.attempts === 'one' ? 'Work at your own pace; your work saves as you go. When you are done, submit once to be scored.'
          : 'Work at your own pace; your work saves as you go. Submit to see your score, then improve and submit again as often as you like: your best score counts.')
        : c.round_seconds ? `You have ${Math.round(c.round_seconds / 60)} minutes.` : 'Your instructor ends the game when time is up.',
    ],
  },
};

const money2 = (v) => { const n = Number(v); return `$${n.toLocaleString(undefined, Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const money2c = (v) => `$${(Math.round(Number(v) * 100) / 100).toFixed(2)}`;
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

const live = (c) => c.pace !== 'self';
const std = (c) => c.level !== 'easy';
const costSettings = [
  S('pace', 'How it runs', 'select', 'Self-paced: opens as soon as you create it (no Start button). Students join any time, work on their own and submit to be scored. You close it when you are done.',
    { options: [['live', 'Live in class: you start and end it'], ['self', 'Self-paced: assignment or practice']] }),
  S('attempts', 'Submissions', 'select', 'One: students see the full answer after submitting. Unlimited: they see which prices they got right and can try again; their best score counts and the answer key appears when you close the game.',
    { options: [['unlimited', 'Unlimited (practice)'], ['one', 'One (assignment)']], showIf: (c) => c.pace === 'self' }),
  S('level', 'Version', 'select', 'Easy: only rent and insurance (fixed) and workers and ingredients (variable). Standard adds costs already paid, a lease you can pause, and income you give up by opening.',
    { options: [['standard', 'Standard'], ['easy', 'Easy: only fixed and variable costs']] }),
  S('team_mode', 'Play as', 'select', 'Anyone on a team can edit the shared worksheet.', { options: [['teams', 'Teams'], ['individual', 'Individuals']], showIf: live }),
  S('team_size', 'Max team size', 'number', 'Students create, join and name their own teams.', { min: 1, max: 8, step: 1, showIf: (c) => live(c) && c.team_mode === 'teams' }),
  S('round_seconds', 'Time limit (seconds)', 'number', '0 = no timer: you end the game. 1800 = 30 minutes.', { min: 0, max: 7200, step: 60, showIf: live }),
  S('checks', 'Worksheet checking', 'select', 'Teams can check each step as they go. Only the supply schedule is scored.', { options: [['on', 'On: teams can check each step'], ['off', 'Off: no checking']] }),
  S('show_answers', 'Show the answer key when the game ends', 'bool', ''),
  S('story', 'Business', 'select', 'Fills in the names below; you can edit them.', { options: [['bakery', 'Bakery (loaves, bakers)'], ['pizza', 'Pizzeria (pizzas, cooks)'], ['coffee', 'Coffee cart (cups, baristas)']] }),
  S('business', 'Business name', 'text', ''), S('product', 'Product (one)', 'text', ''), S('product_plural', 'Product (many)', 'text', ''),
  S('worker', 'Worker (one)', 'text', ''), S('worker_plural', 'Worker (many)', 'text', ''), S('period', 'Time period', 'text', 'The bills are for one of these (day, week…).'),
  S('output', 'Total output with 1, 2, 3… workers', 'text', 'Comma-separated, one number per extra worker. The default rises fast, then slowly (diminishing marginal product).', { maxlength: 120 }),
  S('wage', 'Pay per worker per period ($)', 'number', '', { min: 0, step: 5 }),
  S('material_name', 'Main ingredient', 'text', ''), S('material_unit', 'Its unit', 'text', ''),
  S('material_qty', 'Amount per unit of product', 'number', '', { min: 0, step: 0.05 }), S('material_price', 'Price per unit of ingredient ($)', 'number', '', { min: 0, step: 0.05 }),
  S('extras_name', 'Other ingredients', 'text', '', { showIf: std }), S('extras_cost', 'Other ingredients per unit ($)', 'number', '', { min: 0, step: 0.05, showIf: std }),
  S('package_name', 'Packaging', 'text', ''), S('package_cost', 'Packaging per unit ($)', 'number', '', { min: 0, step: 0.05 }),
  S('energy_name', 'Energy', 'text', '', { showIf: std }), S('energy_cost', 'Energy per batch ($)', 'number', '', { min: 0, step: 0.05, showIf: std }),
  S('batch_size', 'Units per batch', 'number', 'A partial batch costs as much as a full one.', { min: 1, step: 1, showIf: std }),
  S('rent', 'Rent per period ($)', 'number', 'Paid even when closed.', { min: 0, step: 10 }), S('insurance', 'Insurance per period ($)', 'number', 'Paid even when closed.', { min: 0, step: 5 }),
  S('lease_name', 'Leased equipment', 'text', '', { showIf: std }), S('lease', 'Equipment lease per period ($)', 'number', 'Paid only when open.', { min: 0, step: 5, showIf: std }),
  S('sublet_name', 'Who pays to use the space when closed', 'text', '', { showIf: std }), S('sublet', 'They pay ($ per period)', 'number', 'Income given up by opening (an opportunity cost).', { min: 0, step: 5, showIf: std }),
  S('sunk_name', 'Equipment already bought', 'text', '', { showIf: std }), S('sunk_cost', 'Its price ($, sunk)', 'number', '', { min: 0, step: 100, showIf: std }),
  S('ad_cost', 'Prepaid ad ($, sunk)', 'number', '', { min: 0, step: 10, showIf: std }), S('license_cost', 'Yearly license ($, sunk)', 'number', '', { min: 0, step: 10, showIf: std }),
  S('card_fee', 'Card fee (share of sales)', 'number', '0 = no card fee. 0.03 = 3% of every sale.', { min: 0, max: 0.5, step: 0.01, showIf: std }),
  S('prices', 'Prices in the supply schedule', 'text', 'Comma-separated, up to 12.', { maxlength: 80 }),
  S('leaderboard', 'Leaderboard', 'select', '', { options: [['end', 'Show at the end'], ['never', 'Never show students']] }),
];

export const SETTINGS = {
  costs: costSettings,
  competitive: [...teamSettings, ...marketTiming, ...costs,
    S('demand_a', 'Demand intercept (per firm)', 'number', 'Market demand = number of firms × (a − b × P).', { min: 1, step: 5 }),
    S('demand_b', 'Demand slope (per firm)', 'number', '', { min: 0.1, step: 0.5 }),
    S('market_rule', 'How buyers choose', 'select', 'Fixed market price: firms are price takers, as in the textbook; firms priced above it sell little. Cheapest first: buyers go to the lowest prices, so a firm above the going price can still sell if cheaper firms run out (closer to oligopoly).',
      { options: [['fixed', 'Fixed market price (price takers)'], ['cheapest', 'Cheapest sellers first']] }),
    S('market_price', 'Market price ($)', 'number', '0 = the competitive equilibrium for these costs and demand.', { min: 0, step: 0.25, showIf: (c) => c.market_rule !== 'cheapest' }),
    S('price_range', 'Price changes each round by up to ±$', 'number', 'Each round gets a random price in this range around the market price. 0 = the same price every round.', { min: 0, step: 0.5, showIf: (c) => c.market_rule !== 'cheapest' }),
    S('price_step', 'Round prices to the nearest $', 'number', '0.5 gives prices like $7.50, $8.00, $8.50.', { min: 0.05, step: 0.05, showIf: (c) => c.market_rule !== 'cheapest' && Number(c.price_range) > 0 }),
    S('above_market_k', 'How fast sales fall above the market price', 'number', 'Share sold = e^(−k × % above). 30: 2% above sells about 55%, 5% above about 22%, 10% above about 5%.', { min: 1, max: 200, step: 5, showIf: (c) => c.market_rule !== 'cheapest' }),
    S('price_noise', 'Price perception noise', 'number', 'Small random mixing of near-equal prices (0.02 = ±2%).', { min: 0, max: 0.2, step: 0.01, showIf: (c) => c.market_rule === 'cheapest' }),
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
    S('include_house', 'Add 8 computer strategies as extra entrants', 'bool', 'Classic strategies such as Tit for Tat. Students see them only as Computer 1, Computer 2…; you see the real names.'),
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
  commons: [
    S('variant', 'Version', 'select', 'Fishery: the lake regrows from what is left, so overuse builds up over time. Simple: one extract-or-wait choice per round.',
      { options: [['fishery', 'Fishery (choose a catch)'], ['simple', 'Simple (extract or wait)']] }),
    S('group_size', 'Group size', 'number', 'Leftover students are added to some groups.', { min: 2, max: 8, step: 1 }),
    S('matching', 'Groups', 'select', '', { options: [['partners', 'Partners: same group throughout'], ['strangers', 'Strangers: new random group every season/round']] }),
    S('chat', 'Anonymous group chat before deciding', 'select', 'Students message their group as Fisher A, B, C. You can read every message with names.',
      { options: [['on', 'On every season/round'], ['off', 'Off'], ['later', 'Off in the first half, on in the second (compare)']] }),
    S('chat_seconds', 'Seconds to chat', 'number', 'Chat ends early when everyone clicks Ready.', { min: 0, step: 15, showIf: (c) => c.chat !== 'off' }),
    S('decide_seconds', 'Seconds to decide', 'number', '0 = no timer.', { min: 0, step: 5 }),
    S('matches', 'Fishing games', 'number', 'Each starts with full lakes and new groups. Use 2 with chat "Off in the first half" to compare.', { min: 1, max: 10, step: 1, showIf: (c) => c.variant !== 'simple' }),
    S('min_seasons', 'Shortest fishing game (seasons)', 'number', 'Each fishing game has a hidden random length in this range.', { min: 1, step: 1, showIf: (c) => c.variant !== 'simple' }),
    S('max_seasons', 'Longest fishing game (seasons)', 'number', '', { min: 1, step: 1, showIf: (c) => c.variant !== 'simple' }),
    S('fish_per_member', 'Lake size per group member (fish)', 'number', 'Lake capacity = this × group size (60 for a group of 3).', { min: 1, step: 1, showIf: (c) => c.variant !== 'simple' }),
    S('growth', 'Regrowth: fish left are multiplied by', 'number', '2 = what is left doubles (up to capacity). The most a group can catch every season and keep the lake full is capacity × (1 − 1/regrowth).', { min: 1, max: 5, step: 0.1, showIf: (c) => c.variant !== 'simple' }),
    S('max_catch', 'Most fish one person can catch per season', 'number', '', { min: 1, step: 1, showIf: (c) => c.variant !== 'simple' }),
    S('fish_price', 'Earnings per fish ($)', 'number', '', { min: 0.01, step: 0.25, showIf: (c) => c.variant !== 'simple' }),
    S('rounds', 'Rounds', 'number', '', { min: 1, max: 30, step: 1, showIf: (c) => c.variant === 'simple' }),
    S('pool_per_member', 'Pool per group member ($)', 'number', 'Pool = this × group size ($30 for a group of 3).', { min: 1, step: 1, showIf: (c) => c.variant === 'simple' }),
    S('multiplier', 'If everyone waits, the pool is multiplied by', 'number', '', { min: 1, step: 0.5, showIf: (c) => c.variant === 'simple' }),
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
        c.market_rule === 'cheapest'
          ? Q(`You make 80 ${c.product_plural} but price above what buyers will pay. What happens?`, 'You sell nothing and still pay for all 80',
            ['Unsold units carry over to next round', 'You only pay for the units you sell', 'The game sells them at the market price for you'])
          : Q(`You make 80 ${c.product_plural} and price 10% above the market price. What happens?`, 'You sell only a few and still pay for all 80',
            ['You sell all 80 at your higher price', 'Unsold units carry over to next round', 'You only pay for the units you sell']),
        ...(c.market_rule === 'cheapest' ? [] : [Q('You price below the market price. What happens?', 'You sell everything you made, but at your lower price',
          ['You are paid the market price instead', 'You sell nothing', 'You sell more than you made'])]),
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
        Q('Who will your strategy play against?', 'Every other team\'s strategy', ['Only the computer', 'One random team', 'Itself only'])];
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
    case 'commons': {
      const n = c.group_size;
      const anon = Q('Who can see that a chat message came from you?', `Only the instructor; classmates see a letter like ${c.variant === 'simple' ? 'Player' : 'Fisher'} B`,
        ['Everyone in the class', 'Your group sees your name', 'Nobody, not even the instructor']);
      if (c.variant === 'simple') {
        const pool = c.pool_per_member * n;
        return [
          Q('Everyone in your group waits. What do you get?', money2(pool * c.multiplier / n), uniq(money2(pool * c.multiplier / n), [money2(pool / n), money2(pool), money2(0)])),
          Q('You wait, but one groupmate extracts. What do you get?', money2(0), uniq(money2(0), [money2(pool / n), money2(pool * c.multiplier / n), money2(pool / 2)])),
          Q('You extract and everyone else waits. What do you get?', money2(pool), uniq(money2(pool), [money2(pool / n), money2(pool * c.multiplier / n), money2(0)])),
          ...(c.chat === 'off' ? [] : [anon]),
        ];
      }
      const cap = c.fish_per_member * n;
      const take = Math.round(cap / 2);
      const left = cap - take;
      const nextS = Math.min(cap, Math.floor(left * c.growth));
      const each = Math.max(1, Math.round(take / n));
      return [
        Q(`The lake has ${cap} fish and your group catches ${take} in total. How many fish are in the lake next season?`, nextS,
          uniq(nextS, [left, cap - each, Math.min(cap, left + take), Math.floor(left * c.growth) + 10])),
        Q(`You catch ${each} fish. What do you earn this season?`, money2(each * c.fish_price), uniq(money2(each * c.fish_price), [money2(take * c.fish_price), money2(0), money2(cap * c.fish_price / n)])),
        Q('How long does a fishing game last?', `Between ${c.min_seasons} and ${c.max_seasons} seasons, and you won't know when it ends`,
          [`Exactly ${c.max_seasons} seasons`, 'Until the lake is half empty', 'Until the instructor says stop']),
        Q('What happens if the lake is emptied?', 'It stays empty: nobody can catch anything for the rest of that fishing game',
          ['It refills to full next season', 'It refills halfway', 'You get the fish anyway']),
        ...(c.chat === 'off' ? [] : [anon]),
      ];
    }
    case 'costs': {
      const m = costsModel(c);
      const w = Math.min(5, m.maxWorkers), p = c.price_list[Math.min(3, c.price_list.length - 1)];
      return [
        Q(`Your supply schedule says ${w} ${c.worker_plural} at ${money2(p)}. What does that mean?`,
          `If the price is ${money2(p)}, you hire ${w} ${c.worker_plural} and make ${m.rows[w].q} ${c.product_plural}`,
          [`You charge ${money2(p)} per ${c.worker}`, `You make ${w} ${c.product_plural} at ${money2(p)} each`, `You pay each ${c.worker} ${money2(p)}`]),
        Q('How is your score worked out?', 'At every price, by how close your profit comes to the best possible',
          ['By your profit at one random price', 'By how many worksheet cells are right', 'By how fast you finish']),
        Q(`How many ${c.product_plural} can you sell at the market price?`, `Every ${c.product} you make`,
          [`Only as many as you have ${c.worker_plural}`, 'Half of what you make', 'It depends on the other teams']),
      ];
    }
    default: return [];
  }
}
const num2 = (v) => String(Math.round(v * 100) / 100);

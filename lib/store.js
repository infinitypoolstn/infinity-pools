// JSON-file data store for Infinity Pools. Single-process app: in-memory object,
// debounced atomic writes to data/data.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

const id = () => crypto.randomBytes(8).toString('hex');
const token = () => crypto.randomBytes(20).toString('hex');

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const PHASE_TEMPLATE = [
  { key: 'design',     name: 'Design Finalization',      drawPct: 10, time: 'Week 1',      clientSummary: 'We finalize your pool design together — interior finish color, waterline tile, and coping selections — and complete engineering and permitting.', clientLabel: 'Design' },
  { key: 'lotprep',    name: 'Lot Preparation',          drawPct: 0,  time: 'Week 2',      clientSummary: 'The site is prepared for construction: access route, silt fencing, and temporary fencing as needed.', clientLabel: 'Lot Prep' },
  { key: 'excavation', name: 'Excavation',               drawPct: 15, time: 'Weeks 3-5',   clientSummary: 'The big dig! Your pool takes shape as we excavate to the engineered depth and haul off soil.', clientLabel: 'Excavation' },
  { key: 'forming',    name: 'Pool Forming',             drawPct: 25, time: 'Weeks 6-8',   clientSummary: 'Wood forms are built and steel rebar is installed per the engineered plans. Plumbing and electrical lines are run to code.', clientLabel: 'Forming & Steel' },
  { key: 'shotcrete',  name: 'Shotcrete',                drawPct: 25, time: 'Week 9',      clientSummary: 'Concrete is pneumatically applied over the rebar to create your pool’s permanent structural shell.', clientLabel: 'Shotcrete' },
  { key: 'tile',       name: 'Tile & Plaster',           drawPct: 15, time: 'Weeks 10-11', clientSummary: 'Waterline tile, coping, and your selected PebbleTec interior finish are installed. It finally looks like a pool!', clientLabel: 'Tile & Finish' },
  { key: 'completion', name: 'Completion & Activation',  drawPct: 10, time: 'Week 12',     clientSummary: 'The pool is filled, equipment is started up, water chemistry is balanced, and the job site is cleaned. Time to swim!', clientLabel: 'Splash Day' },
];

// Scope of Work template — general descriptions only (no sizes or dollar values).
const SCOPE_TEMPLATE = [
  { key: 'design', title: 'Design', items: [
    'Pre-construction design coordination with the client',
    'Standard Pebble Tec & Pebble Sheen colors included. Other finish colors are available, but will require additional cost.',
    'Waterline tile, coping, and interior finish selections to be finalized during the design phase',
  ]},
  { key: 'lotprep', title: 'Lot Preparation', items: [
    'GC to provide construction driveway, silt fencing, and temporary fencing as needed',
  ]},
  { key: 'excavation', title: 'Excavation', items: [
    'Remove dirt as needed for pool (see Stop Work Clause)',
    'Excavation based on normal soil conditions; rock and unforeseen subsurface conditions handled per Disclosures',
  ]},
  { key: 'forming', title: 'Pool Forming', items: [
    'Wood form to be built',
    'Rebar to be installed per engineered specifications',
    'Plumbing to be installed per applicable codes',
    'Electrical to be installed per applicable codes',
  ]},
  { key: 'shotcrete', title: 'Shotcrete', items: [
    'Shotcrete installed over rebar and plumbing',
  ]},
  { key: 'tile', title: 'Tile & Plaster', items: [
    'Tile at waterline to be installed',
    'PebbleTec interior finish to be installed',
    'Coping to be installed',
  ]},
  { key: 'completion', title: 'Completion & Activation', items: [
    'Activate pool and start up equipment',
    'Initial water chemistry balancing',
    'Clean up job site',
  ]},
  { key: 'equipment', title: 'Equipment & Systems', items: [
    'Installation of all pool equipment and equipment pad, including pump, filtration system, salt cell, plumbing for blower, heater, and LED lighting',
    'Final system activation and orientation',
    'Owner to provide electrical panel service to equipment pad',
    'Owner to provide gas line to heater',
  ]},
  { key: 'landscaping', title: 'Landscaping', items: [
    'All landscaping, irrigation, landscape lighting, sod, and plantings to be completed by another vendor',
  ]},
];

// Universal Disclosures, Exclusions & Site Conditions (from the signed sample contract).
const DISCLOSURES_TEMPLATE = [
  { title: 'Items Not Included in This Estimate', body: 'This document clearly outlines items and conditions that are not included in this estimate, as well as important site-related disclosures that may affect the final scope, timeline, and pricing of the project. Unless expressly stated in the signed proposal or a written change order, the following items and conditions are excluded:\n• Survey fees\n• Engineering costs outside of the pool shell\n• Landscaping services, landscape restoration, or sod replacement\n• Decking materials or decking installation\n• Backfilling around the pool (see Backfilling Responsibility below)' },
  { title: 'Backfilling Responsibility', body: 'Backfilling is the responsibility of the General Contractor (GC) or hardscape professional unless otherwise stated in writing. If backfilling is not performed correctly and results in damage to plumbing, piping, or related pool components, Infinity Pools will not be held responsible for such damage or associated repairs.' },
  { title: 'Groundwater / Dewatering Exclusion', body: 'Groundwater dewatering is not included in this estimate. If groundwater becomes an issue at any point during construction, a site evaluation will be conducted and a written change order will be required to address and mitigate natural water conditions, including (as applicable): dewatering methods, drainage improvements, stone, pumps, or additional materials and labor.' },
  { title: 'Rock / Unforeseen Subsurface Conditions', body: 'This estimate is based on normal excavation conditions. Rock, ledge, shale, buried debris, unsuitable soils, underground obstructions, or other unforeseen subsurface conditions encountered during excavation are not included in the pool cost and will require additional excavation charges.\n\nIf rock or other unforeseen conditions are encountered, Infinity Pools will provide the Owner/GC with:\n• A description of the condition discovered\n• A scope of the additional work required\n• Pricing for the additional excavation or mitigation\n\nStop-Work Opportunity: Upon discovery of unforeseen subsurface conditions, Infinity Pools will pause excavation within reason to allow the Owner/GC to review and authorize any additional cost. Delays caused by the stop-work review, engineering review, or third-party decision-making may impact the project schedule. Rock removal, if encountered, will be billed at the rate stated in the Scope of Work or via written change order. Infinity Pools shall not be liable for schedule impacts, consequential damages, or additional costs arising from unforeseen subsurface conditions or any stop-work review period.\n\nHaul-Off Allowances: Up to five (5) tri-axle haul-offs and five (5) gravel loads are included. Beyond these, additional tri-axle haul-offs are billed at $500 per truck; additional gravel loads are billed at $1,000 per load.' },
  { title: 'Utility Locates & Markings', body: 'The Owner/GC is responsible for accurately locating and marking all private utilities, irrigation lines, septic systems, wells, or other underground obstructions not covered by public locate services. Infinity Pools will call 811 for public utility locates prior to excavation, but assumes no liability for inaccuracies in public locates or for any unmarked private lines. Damage to unmarked utilities or obstructions shall be repaired at the sole expense of the Owner/GC, including any resulting delays or additional costs.' },
  { title: 'Automatic Pool Fill Line — Not Activated at Completion', body: 'An automatic pool fill line is included in this proposal; however, it will not be connected or activated at the time of project completion. This is intentional — an active auto-fill system could conceal potential issues that should present themselves immediately after filling. We request that the auto-fill line not be connected for a period of six (6) months after the pool has been filled with water, unless otherwise approved in writing by Infinity Pools.' },
  { title: 'Schedule, Weather & Site Access', body: 'All timelines are subject to weather, site conditions, inspection scheduling, and material availability. The Owner/GC is responsible for ensuring reasonable site access for crews, deliveries, and equipment throughout the project. Delays or inefficiencies caused by limited access, unsafe conditions, site readiness, Owner/GC actions or inactions, permitting, inspections, material availability, or any other factors beyond Infinity Pools’ direct control may result in schedule impacts, additional charges, and/or timeline extensions. Infinity Pools shall not be liable for any consequential damages arising from such delays.' },
  { title: 'Change Orders', body: 'Any work, conditions, or materials not specifically included in the signed estimate will be handled through a written change order prior to performance. This includes labor and material price adjustments due to site conditions, code requirements, or owner-requested changes. Verbal authorizations are not binding.' },
  { title: 'Maintenance', body: 'Infinity Pools will handle the first 30 days of maintenance for water chemistry only (initial balancing and adjustments after filling). Ongoing maintenance, cleaning, and chemistry management thereafter is the Owner’s sole responsibility. Infinity Pools assumes no liability for water-quality issues, staining, algae, scale, or equipment damage after the 30-day period if proper maintenance is not followed.' },
  { title: 'Demolition & Site Impact Exclusion', body: 'Client acknowledges that demolition and removal of an existing pool or additional structures may impact surrounding decking, hardscape, landscaping, irrigation, utilities, or other adjacent improvements. Infinity Pools assumes no responsibility for damage to, settlement of, or alteration of these areas. Repair or replacement of affected site elements is specifically excluded unless otherwise agreed upon in writing. This includes settling, cracking, or shifting of adjacent hardscape, decking, landscaping, or structures due to normal construction vibrations or soil movement.' },
  { title: 'Equipment Warranty Registration Responsibility', body: 'Infinity Pools supplies equipment (pump, heater, filtration system, LED lights, blower, etc.) that includes manufacturer warranties. Upon final pool activation and project completion, Infinity Pools will provide the Owner/GC with all necessary registration information, including serial numbers, model details, installation certificates, and manufacturer-specific instructions. It is the responsibility of the Homeowner (preferred) or General Contractor to file and submit all warranty registrations directly with the respective manufacturers within each manufacturer’s required deadlines. Infinity Pools will not register warranties on behalf of the Owner/GC. Failure to register may result in warranties becoming void or claims being denied. Infinity Pools shall have no liability for denied claims arising from failure to register.\n\nRecommendation: We strongly encourage the Homeowner to handle warranty registration directly to ensure all warranties are activated under their name and ownership.' },
];

// Pebble finish library — tiers per the 2026 Pool Builder Rates sheet; swatch
// images from pebbletec.com/products/all-finishes/. Prices intentionally kept
// internal (priceNote) and NEVER shown on client-facing design sheets.
const U = 'https://pebbletec.com/wp-content/uploads/';
const FINISHES_SEED = [
  // --- PebbleTec (The Original) ---
  { brand: 'PebbleTec', tier: 'Standard', name: 'Caribbean Blue', imageUrl: U + '2021/10/pt-sample-carribean-blue-1200x1000.jpg', color: '#2f7fae' },
  { brand: 'PebbleTec', tier: 'Standard', name: 'Sandy Beach', imageUrl: U + '2021/09/pt-sample-sandy-beach-1200x1000.jpg', color: '#cbb89a' },
  { brand: 'PebbleTec', tier: 'Standard', name: 'Tahoe Blue', imageUrl: U + '2021/10/pt-sample-tahoe-blue-1200x1000.jpg', color: '#3a6f8f' },
  { brand: 'PebbleTec', tier: 'Standard', name: 'White Pearl', imageUrl: U + '2021/09/pt-sample-white-pearl-1200x1000.jpg', color: '#dfe3e2' },
  { brand: 'PebbleTec', tier: 'Upgrade', name: 'Black Marble', imageUrl: U + '2021/09/pt-sample-black-marble-1200x1000.jpg', color: '#33383c' },
  { brand: 'PebbleTec', tier: 'Upgrade', name: 'Black Pearl', imageUrl: U + '2021/09/pt-sample-black-pearl-1200x1000.jpg', color: '#26292d' },
  { brand: 'PebbleTec', tier: 'Upgrade', name: 'Blue Lagoon', imageUrl: U + '2021/09/pt-sample-blue-lagoon-1200x1000.jpg', color: '#3173a4' },
  { brand: 'PebbleTec', tier: 'Upgrade', name: 'Blue Wave', imageUrl: U + '2021/09/pt-sample-blue-wave-1200x1000.jpg', color: '#39618c' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Crème de Menthe', imageUrl: U + '2021/09/pt-sample-creme-de-menthe-1200x1000.jpg', color: '#9fb6a4' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Emerald Bay', imageUrl: U + '2021/10/pt-sample-emerald-bay-1200x1000.jpg', color: '#2a6f63' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Jade', imageUrl: null, color: '#2e6f5e' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Midnight Blue', imageUrl: U + '2021/10/pt-sample-midnight-blue-1200x1000.jpg', color: '#1d3a5f' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Sky Blue', imageUrl: U + '2021/09/pt-sample-sky-blue-1200x1000.jpg', color: '#7fb2d4' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Moonlight Grey', imageUrl: U + '2021/09/pt-sample-moonlight-grey-1200x1000.jpg', color: '#9aa3a8' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Soft White', imageUrl: U + '2021/09/pt-sample-soft-white-1200x1000.jpg', color: '#e8eae6' },
  { brand: 'PebbleTec', tier: 'Premium', name: 'Tropical Breeze', shimmer: true, imageUrl: U + '2021/10/pt-sample-tropical-breeze-1200x1000.jpg', color: '#5fa8b8' },
  // --- PebbleSheen (Refined Textured Finish) ---
  { brand: 'PebbleSheen', tier: 'Standard', name: 'Desert Gold', imageUrl: U + '2021/11/ps-sample-desert-gold-1200x1000.jpg', color: '#c2a878' },
  { brand: 'PebbleSheen', tier: 'Standard', name: 'French Grey', imageUrl: U + '2021/11/ps-sample-french-grey-1200x1000.jpg', color: '#8d9499' },
  { brand: 'PebbleSheen', tier: 'Standard', name: 'Irish Mist', imageUrl: U + '2021/11/ps-sample-irish-mist-1200x1000.jpg', color: '#b9c4b4' },
  { brand: 'PebbleSheen', tier: 'Standard', name: 'White Diamonds', imageUrl: U + '2021/11/ps-sample-white-diamonds-1200x1000.jpg', color: '#e3e6e4' },
  { brand: 'PebbleSheen', tier: 'Upgrade', name: 'Aqua Blue', imageUrl: U + '2021/11/ps-sample-aqua-blue-1200x1000.jpg', color: '#3e93b8' },
  { brand: 'PebbleSheen', tier: 'Upgrade', name: 'Black Onyx', imageUrl: U + '2021/10/ps-sample-black-onyx-1200x1000.jpg', color: '#23262a' },
  { brand: 'PebbleSheen', tier: 'Upgrade', name: 'Blue Granite', imageUrl: U + '2021/11/ps-sample-blue-granite-1200x1000.jpg', color: '#41637e' },
  { brand: 'PebbleSheen', tier: 'Upgrade', name: 'Blue Surf', imageUrl: U + '2021/11/ps-sample-blue-surf-1200x1000.jpg', color: '#4a7d9e' },
  { brand: 'PebbleSheen', tier: 'Upgrade', name: 'Bordeaux', imageUrl: U + '2021/11/ps-sample-bordeaux-1200x1000.jpg', color: '#6e5149' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Ocean Blue', shimmer: true, imageUrl: U + '2021/11/ps-sample-ocean-blue-1200x1000.jpg', color: '#23618c' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Prism Blue', shimmer: true, imageUrl: U + '2021/11/ps-sample-prism-blue-1200x1000.jpg', color: '#3f7fae' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Seafoam Green', imageUrl: null, color: '#7fbfa8' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Slate Blue', shimmer: true, imageUrl: U + '2021/11/ps-sample-slate-blue-1200x1000.jpg', color: '#4d6675' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Turtle Bay', shimmer: true, imageUrl: U + '2021/11/ps-sample-turtle-bay-1200x1000.jpg', color: '#4e7d6e' },
  { brand: 'PebbleSheen', tier: 'Premium', name: 'Black Eclipse', shimmer: true, imageUrl: U + '2022/08/ps-sample-black-eclipse-2-1200x1000.jpg', color: '#1d2024' },
  { brand: 'PebbleSheen', tier: 'Extra Premium', name: 'Arctic White', imageUrl: U + '2021/11/ps-sample-arctic-white-1200x1000.jpg', color: '#eef0ee' },
  { brand: 'PebbleSheen', tier: 'Extra Premium', name: 'Cool Blue', imageUrl: U + '2021/11/ps-sample-cool-blue-1200x1000.jpg', color: '#6fa9c9' },
  // --- PebbleFina (Enduring Smooth Finish) ---
  { brand: 'PebbleFina', tier: 'Upgrade', name: 'Acquos', imageUrl: U + '2021/11/pf-sample-acquos-1200x1000.jpg', color: '#4f93b4' },
  { brand: 'PebbleFina', tier: 'Upgrade', name: 'Classico', imageUrl: U + '2021/11/pf-sample-classico-1200x1000.jpg', color: '#d9d6cc' },
  { brand: 'PebbleFina', tier: 'Upgrade', name: 'Bella Blue', imageUrl: U + '2021/11/pf-sample-bella-blue-1200x1000.jpg', color: '#4a7fa5' },
  { brand: 'PebbleFina', tier: 'Upgrade', name: 'Grigio', imageUrl: U + '2021/11/pf-sample-grigio-1200x1000.jpg', color: '#9b9d9a' },
  { brand: 'PebbleFina', tier: 'Upgrade', name: 'Steel Grey', imageUrl: U + '2021/11/pf-sample-steel-gray-1-1200x1000.jpg', color: '#6f7779' },
  { brand: 'PebbleFina', tier: 'Premium', name: 'Black Galaxy', shimmer: true, imageUrl: null, color: '#1a1d24' },
  { brand: 'PebbleFina', tier: 'Premium', name: 'Cielo Blue', imageUrl: U + '2021/11/pf-sample-cielo-blue-1200x1000.jpg', color: '#5e9ec4' },
  { brand: 'PebbleFina', tier: 'Premium', name: 'Fresca Verde', imageUrl: U + '2021/11/pf-sample-fresca-verde-1200x1000.jpg', color: '#7da895' },
  { brand: 'PebbleFina', tier: 'Premium', name: 'Emerald Galaxy', shimmer: true, imageUrl: null, color: '#14463a' },
  { brand: 'PebbleFina', tier: 'Premium', name: 'Sapphire Galaxy', shimmer: true, imageUrl: null, color: '#16365c' },
  // --- PebbleBrilliance (Elegant Infused Finish, single tier) ---
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Aqua Falls', imageUrl: U + '2021/11/pb-sample-aqua-falls-1200x1000.jpg', color: '#54a3bd' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Clearwater', imageUrl: U + '2021/11/pb-sample-clearwater-1200x1000.jpg', color: '#79b8cf' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Crystal Harbor', imageUrl: U + '2021/11/pb-sample-crystal-harbor-1200x1000.jpg', color: '#a9c8d4' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Deep Cove', imageUrl: U + '2021/11/pb-sample-deep-cove-1200x1000.jpg', color: '#2b5670' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Glacier Bay', imageUrl: U + '2021/11/pb-sample-glacier-bay-1200x1000.jpg', color: '#b9d3da' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Tropicana', imageUrl: U + '2021/11/pb-sample-tropicana-1200x1000.jpg', color: '#4f9fae' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Majestic Sound', imageUrl: U + '2021/11/pb-sample-majestic-sound-1200x1000.jpg', color: '#5c7c92' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'North Sea', imageUrl: null, color: '#1e4d6b' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Oasis', imageUrl: U + '2021/11/pb-sample-oasis-1200x1000.jpg', color: '#62a8a1' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Shoreline', imageUrl: U + '2021/11/pb-sample-shoreline-1200x1000.jpg', color: '#c4ccc2' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Sparkling Water', imageUrl: U + '2021/11/pb-sample-sparkling-water-1200x1000.jpg', color: '#8fc3d4' },
  { brand: 'PebbleBrilliance', tier: 'Brilliance', name: 'Vivid Shores', imageUrl: U + '2021/11/pb-sample-vivid-shores-1200x1000.jpg', color: '#3e8fae' },
];

// Automatic task workflows — when a phase becomes active, these tasks are
// created for the project. dueOffsetDays counts from the day the phase starts.
// Assignees (employeeId) are configured in Settings once employees exist.
const TASK_TEMPLATES = {
  design: [
    { title: 'Collect client selections: finish color, waterline tile, coping', dueOffsetDays: 3 },
    { title: 'Submit permit application', dueOffsetDays: 2 },
    { title: 'Order engineered plans (pool shell)', dueOffsetDays: 2 },
    { title: 'Schedule 811 public utility locate', dueOffsetDays: 5 },
  ],
  lotprep: [
    { title: 'Confirm construction driveway & silt fencing with GC', dueOffsetDays: 1 },
    { title: 'Set temporary fencing as needed', dueOffsetDays: 3 },
  ],
  excavation: [
    { title: 'Verify 811 locates are complete BEFORE digging', dueOffsetDays: 0 },
    { title: 'Schedule excavation crew & equipment', dueOffsetDays: 1 },
    { title: 'Confirm tri-axle haul-off trucking (5 loads included)', dueOffsetDays: 1 },
  ],
  forming: [
    { title: 'Order rebar package per engineered plans', dueOffsetDays: 1 },
    { title: 'Schedule plumbing rough-in', dueOffsetDays: 3 },
    { title: 'Schedule electrical rough-in', dueOffsetDays: 3 },
    { title: 'Book pre-gunite inspection', dueOffsetDays: 10 },
  ],
  shotcrete: [
    { title: 'Schedule shotcrete crew', dueOffsetDays: 1 },
    { title: 'Start shell water-cure routine (client or crew)', dueOffsetDays: 3 },
  ],
  tile: [
    { title: 'Confirm finish color with client in writing', dueOffsetDays: 0 },
    { title: 'Order waterline tile & coping', dueOffsetDays: 1 },
    { title: 'Schedule plaster/interior finish crew', dueOffsetDays: 3 },
  ],
  completion: [
    { title: 'Schedule equipment startup & pool activation', dueOffsetDays: 1 },
    { title: 'Initial water chemistry balancing (30-day window starts)', dueOffsetDays: 3 },
    { title: 'Final site cleanup & client walkthrough', dueOffsetDays: 5 },
    { title: 'Send equipment warranty registration info to client', dueOffsetDays: 5 },
  ],
};

const FINANCE_DEFAULT_ITEMS = ['Excavation', 'Pool Forming', 'Shotcrete', 'Tile', 'Materials', 'Labor'];
const LEDGE_STYLES = ['Baja Ledge', 'Tanning Ledge', 'Bench Seating', 'Swim-Up Bar Seating', 'Wrap-Around Step Seating', 'Other'];
const FILE_CATEGORIES = ['Plans', 'Pool Renderings', 'Permits', 'Material Invoices', 'Labor Invoices', 'Other'];
const CONTRACTOR_CATEGORIES = ['Excavation', 'Plumbing', 'Electrical', 'Shotcrete', 'Plaster / Interior Finish', 'Tile & Coping', 'Decking / Hardscape', 'Fencing', 'Landscaping', 'Gas', 'Inspection / Engineering', 'Hauling', 'Other'];

function defaults() {
  return {
    settings: {
      companyName: 'Infinity Pools',
      companyEmail: 'admin@infinitypoolstn.com',
      companyPhone: '',
      companyAddress: 'Nashville, TN',
      gmail: { user: 'admin@infinitypoolstn.com', appPassword: '' },
      quickbooks: {
        connected: false, realmId: '', clientId: '', clientSecret: '', refreshToken: '',
        environment: 'production',
        achFeeNote: 'ACH bank transfer: 1% processing fee',
        ccFeeNote: 'Credit / debit card: 3.5% processing fee',
        passFeesToClient: true,
      },
      adobeSign: {
        integrationKey: '',
        apiBaseUri: 'https://api.na1.adobesign.com',
      },
      docuseal: {
        apiKey: '',
        apiBaseUri: 'https://api.docuseal.com',
      },
      haulRates: {
        triAxle: 500,
        gravel: 1000,
      },
      disclosures: DISCLOSURES_TEMPLATE.map(d => ({ id: id(), ...d })),
      scopeTemplate: SCOPE_TEMPLATE,
      phaseTemplate: PHASE_TEMPLATE,
      ledgeStyles: LEDGE_STYLES,
      fileCategories: FILE_CATEGORIES,
      contractorCategories: CONTRACTOR_CATEGORIES,
      alertDaysBefore: 3,
      pebbleCheckEmail: 'admin@infinitypoolstn.com',
      taskTemplates: JSON.parse(JSON.stringify(TASK_TEMPLATES)),
    },
    employees: [],
    contractors: [],
    clients: [],
    tasks: [],
    alerts: [],
    outbox: [],
    errorLog: [],
    finishes: FINISHES_SEED.map(f => ({ id: id(), active: true, source: 'seed', shimmer: !!f.shimmer, ...f })),
    pebbleCheck: { lastRun: null, lastResult: null },
  };
}

// Phase list to seed onto a new/reset project. Uses the (possibly customized)
// settings.phaseTemplate when available, otherwise the built-in PHASE_TEMPLATE.
function freshPhases() {
  const src = (data && data.settings && Array.isArray(data.settings.phaseTemplate) && data.settings.phaseTemplate.length)
    ? data.settings.phaseTemplate : PHASE_TEMPLATE;
  return src.map(p => ({
    key: p.key, name: p.name, drawPct: p.drawPct, time: p.time,
    status: 'pending',
    startedAt: null, dueDate: null, completedAt: null,
    paymentRequestedAt: null, paymentReceivedAt: null, paymentMethod: null, paymentLink: '',
  }));
}

// Pool Specs: five priced sections + add-ons. Each section's price feeds the
// Finance "Price Quote" (see specsToFinance), so the two totals always match.
function freshSpecs() {
  return {
    poolBase: {
      price: 0, shape: 'geometric', freeform: '', size: '', depth: '',
      jets: '', ledLights: '',
      sunShelf: { included: false, details: '' },
      spillover: { included: false, details: '' },
      ledgeSeating: { included: false, details: '' },
    },
    spaBase: { included: false, price: 0, size: '', jets: '', ledLights: '', details: '' },
    waterFeature: { included: false, price: 0, details: '' },
    coldPlunge: { included: false, price: 0, details: '' },
    fireFeature: { included: false, price: 0, details: '' },
    addOns: [], // { label, value, price }
  };
}

// Map a pre-restructure specs object onto the new five-section shape. Idempotent:
// if specs already has poolBase it's left alone (prices preserved).
function migrateSpecs(c) {
  const s = c.specs;
  if (!s) return;
  if (!s.poolBase) {
    c.specs = {
      poolBase: {
        price: 0,
        shape: s.shape || 'geometric',
        freeform: '',
        size: s.sizeDetails || '',
        depth: '',
        jets: s.jets || '',
        ledLights: s.ledLights || '',
        sunShelf: { included: !!(s.sunShelf && s.sunShelf.included), details: (s.sunShelf && s.sunShelf.details) || '' },
        spillover: { included: !!(s.spillover && s.spillover.included), details: (s.spillover && s.spillover.details) || '' },
        ledgeSeating: { included: !!(s.ledgeSeating && s.ledgeSeating.included), details: (s.ledgeSeating && s.ledgeSeating.details) || '' },
      },
      spaBase: { included: !!(s.hotTub && s.hotTub.included), price: 0, size: (s.hotTub && s.hotTub.details) || '', jets: (s.hotTub && s.hotTub.jets) || '', ledLights: (s.hotTub && s.hotTub.ledLights) || '' },
      waterFeature: { included: !!(s.waterFeature && s.waterFeature.included), price: 0, details: (s.waterFeature && s.waterFeature.details) || '' },
      coldPlunge: { included: !!(s.coldPlunge && s.coldPlunge.included), price: 0, details: (s.coldPlunge && s.coldPlunge.details) || '' },
      fireFeature: { included: !!(s.fireFeature && s.fireFeature.included), price: 0, details: (s.fireFeature && s.fireFeature.details) || '' },
      addOns: (s.addOns || []).map(a => ({ label: a.label || '', value: a.value || '', price: Number(a.price) || 0 })),
    };
  }
  // Normalize fields that changed after the first restructure: Spillover became an
  // include/details object, and the duplicate free-text Shape field was removed.
  const pb = c.specs.poolBase;
  if (pb) {
    if (typeof pb.spillover === 'string') pb.spillover = { included: !!pb.spillover.trim(), details: pb.spillover };
    if (!pb.spillover || typeof pb.spillover !== 'object') pb.spillover = { included: false, details: '' };
    delete pb.shapeText;
  }
  if (c.specs.spaBase && c.specs.spaBase.details === undefined) c.specs.spaBase.details = '';
}

// Build Finance line items from the priced spec sections — the single source of
// truth for the quote. Only included sections (and labelled add-ons) contribute.
function specsToFinance(specs) {
  const s = specs || {};
  const num = v => Number(v) || 0;
  const items = [];
  items.push({ id: id(), label: 'Pool Base', amount: num(s.poolBase && s.poolBase.price) });
  if (s.spaBase && s.spaBase.included) items.push({ id: id(), label: 'Spa Base', amount: num(s.spaBase.price) });
  if (s.waterFeature && s.waterFeature.included) items.push({ id: id(), label: 'Water Feature', amount: num(s.waterFeature.price) });
  if (s.coldPlunge && s.coldPlunge.included) items.push({ id: id(), label: 'Cold Plunge', amount: num(s.coldPlunge.price) });
  if (s.fireFeature && s.fireFeature.included) items.push({ id: id(), label: 'Fire Feature', amount: num(s.fireFeature.price) });
  for (const a of (s.addOns || [])) if ((a.label || '').trim()) items.push({ id: id(), label: a.label, amount: num(a.price) });
  return { items };
}

/**
 * Cancel / Start Over: reset a project's BUILD progress to a fresh pre-contract
 * state while keeping the client identity, contact info, address, quote/finance,
 * specs, scope, selected finishes, files, and portal link. Does NOT delete the
 * QuickBooks estimate/invoices already created — those must be voided in QBO.
 */
function resetBuild(client) {
  client.status = 'prospect';
  client.specsLocked = false;
  client.phases = freshPhases();
  client.changeOrders = [];
  client.contract = { sentAt: null, signedAt: null, signedMethod: null, depositMethod: null };
  client.quickbooks = { invoiceId: null, invoiceUrl: null, estimateId: null, estimateUrl: null, payLink: null };
  save();
}

function newClient({ name, address, email, phone }) {
  return {
    id: id(),
    portalToken: token(),
    createdAt: new Date().toISOString(),
    name: name || '', address: address || '', email: email || '', phone: phone || '',
    status: 'prospect', // prospect | contract_sent | active | completed | lost
    specs: freshSpecs(),
    specsLocked: false,
    scope: JSON.parse(JSON.stringify((data && data.settings && data.settings.scopeTemplate) || SCOPE_TEMPLATE)),
    finance: { items: FINANCE_DEFAULT_ITEMS.map(label => ({ id: id(), label, amount: 0 })) },
    costs: { items: [] },
    phases: freshPhases(),
    changeOrders: [],
    files: [],
    selectedFinishes: [],
    clientTodos: [],
    hauls: { triAxle: 0, gravel: 0 },
    contract: { sentAt: null, signedAt: null, signedMethod: null, depositMethod: null },
    quickbooks: { invoiceId: null, invoiceUrl: null, estimateId: null, estimateUrl: null, payLink: null },
    notes: '',
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
let data = null;
let saveTimer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // merge in any new settings keys added after first run
    const d = defaults();
    data.settings = Object.assign({}, d.settings, data.settings);
    for (const k of Object.keys(d)) if (data[k] === undefined) data[k] = d[k];
    // migrate pre-restructure specs onto the five-section priced shape
    for (const c of (data.clients || [])) migrateSpecs(c);
  } else {
    data = defaults();
    saveNow();
  }
  return data;
}

function saveNow() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('save failed:', e.message); } }, 300);
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------
const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);

function quoteTotal(client) { return sum(client.finance.items.map(i => i.amount)); }
function changeOrderTotal(client) { return sum(client.changeOrders.map(c => c.value)); }
function contractTotal(client) { return quoteTotal(client) + changeOrderTotal(client); }
function costTotal(client) { return sum(client.costs.items.map(i => i.amount)); }
function phaseAmount(client, phase) { return Math.round(quoteTotal(client) * phase.drawPct) / 100; }
function collected(client) {
  return sum(client.phases.filter(p => p.paymentReceivedAt).map(p => phaseAmount(client, p)));
}
function currentPhase(client) { return client.phases.find(p => p.status === 'active') || null; }

function addAlert(message, { clientId = null, type = 'info' } = {}) {
  data.alerts.unshift({ id: id(), message, clientId, type, createdAt: new Date().toISOString(), read: false });
  if (data.alerts.length > 500) data.alerts.length = 500;
  save();
}

function addError(method, path, message, stack) {
  if (!data.errorLog) data.errorLog = [];
  data.errorLog.unshift({ id: id(), method, path, message, stack: stack || null, createdAt: new Date().toISOString() });
  if (data.errorLog.length > 200) data.errorLog.length = 200;
  save();
}

module.exports = {
  load, save, saveNow, id, token, newClient, resetBuild, addAlert, addError,
  freshSpecs, migrateSpecs, specsToFinance,
  quoteTotal, changeOrderTotal, contractTotal, costTotal, phaseAmount, collected, currentPhase,
  get data() { return data; },
  PHASE_TEMPLATE, SCOPE_TEMPLATE, FINISHES_SEED,
};

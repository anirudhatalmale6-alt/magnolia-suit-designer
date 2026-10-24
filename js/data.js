/* Default catalogue for the demo. Everything here is editable in the admin dashboard.
 * Prices are sample placeholders only — Magnolia Bespoke sets the real ones. */
window.DEFAULT_CATALOG = {
  version: 3,
  settings: {
    currency: '$',
    jacketOnlyPct: 70,
    pantsOnlyPct: 35,
    notifyNote: 'New designs appear in the dashboard under Submissions.'
  },
  fabrics: [
    { id: 'f-navy', name: 'Midnight Navy', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#1c2840' } },
    { id: 'f-charcoal', name: 'Charcoal Grey', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#3a3d43' } },
    { id: 'f-black', name: 'Classic Black', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#17171a' } },
    { id: 'f-teal', name: 'Magnolia Teal', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#1f4f54' } },
    { id: 'f-stone', name: 'Light Stone', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#b5a88e' } },
    { id: 'f-burgundy', name: 'Deep Burgundy', type: 'Solid', price: 695, visible: true, pattern: { kind: 'solid', base: '#5a1f2a' } },
    { id: 'f-navypin', name: 'Navy Pinstripe', type: 'Pinstripe', price: 795, visible: true, pattern: { kind: 'pinstripe', base: '#1b2641', accent: '#c7ccd8' } },
    { id: 'f-chalk', name: 'Charcoal Chalk Stripe', type: 'Chalk Stripe', price: 795, visible: true, pattern: { kind: 'chalkstripe', base: '#34373c', accent: '#c9ccd1' } },
    { id: 'f-greyhb', name: 'Grey Herringbone', type: 'Herringbone', price: 795, visible: true, pattern: { kind: 'herringbone', base: '#5f6266', accent: '#a9acb0' } },
    { id: 'f-brownhb', name: 'Tobacco Herringbone', type: 'Herringbone', price: 795, visible: true, pattern: { kind: 'herringbone', base: '#5a4431', accent: '#9b7f60' } },
    { id: 'f-glen', name: 'Grey Glen Check', type: 'Check', price: 895, visible: true, pattern: { kind: 'glencheck', base: '#8a8c90', accent: '#383b41', accent2: '#3e5f8a' } },
    { id: 'f-window', name: 'Navy Windowpane', type: 'Windowpane', price: 895, visible: true, pattern: { kind: 'windowpane', base: '#212e4b', accent: '#8ea3c4' } },
    { id: 'f-olive', name: 'Olive Birdseye', type: 'Birdseye', price: 895, visible: true, pattern: { kind: 'birdseye', base: '#4b5034', accent: '#8c9168' } }
  ],
  linings: [
    { id: 'l-teal', name: 'Teal Satin', price: 0, visible: true, pattern: { kind: 'satin', base: '#2f9fa4' } },
    { id: 'l-ivory', name: 'Ivory Satin', price: 0, visible: true, pattern: { kind: 'satin', base: '#e6dfcc' } },
    { id: 'l-burgundy', name: 'Burgundy Satin', price: 0, visible: true, pattern: { kind: 'satin', base: '#6b1e2d' } },
    { id: 'l-black', name: 'Black Satin', price: 0, visible: true, pattern: { kind: 'satin', base: '#1b1b1e' } },
    { id: 'l-paisley', name: 'Gold Paisley', price: 40, visible: true, pattern: { kind: 'paisley', base: '#6e4d12', accent: '#d9b25a' } },
    { id: 'l-navydot', name: 'Navy Polka Dot', price: 40, visible: true, pattern: { kind: 'dot', base: '#1e2a49', accent: '#d5dcec' } },
    { id: 'l-stripe', name: 'Silver Bengal Stripe', price: 40, visible: true, pattern: { kind: 'stripe', base: '#b3b7bd', accent: '#6f747b' } },
    { id: 'l-emerald', name: 'Emerald Geometric', price: 40, visible: true, pattern: { kind: 'geo', base: '#1d5a44', accent: '#cfae5f' } }
  ],
  buttons: [
    { id: 'b-darkhorn', name: 'Dark Horn', style: 'horn', color: '#3a2819', price: 0, visible: true },
    { id: 'b-lighthorn', name: 'Light Horn', style: 'horn', color: '#a47a50', price: 0, visible: true },
    { id: 'b-black', name: 'Matte Black', style: 'horn', color: '#141414', price: 0, visible: true },
    { id: 'b-navy', name: 'Navy', style: 'horn', color: '#1f2a44', price: 0, visible: true },
    { id: 'b-pearl', name: 'Mother of Pearl', style: 'pearl', color: '#e2ddd2', price: 30, visible: true },
    { id: 'b-gold', name: 'Gold Metal', style: 'metal', color: '#c39a3e', price: 30, visible: true },
    { id: 'b-silver', name: 'Silver Metal', style: 'metal', color: '#a8adb4', price: 30, visible: true },
    { id: 'b-fabric', name: 'Covered in Suit Fabric', style: 'fabric', color: '#333333', price: 20, visible: true }
  ],
  threads: [
    { id: 't-match', name: 'Match Buttons', color: 'match', visible: true },
    { id: 't-ivory', name: 'Ivory', color: '#efe7d2', visible: true },
    { id: 't-teal', name: 'Teal', color: '#3fb6ba', visible: true },
    { id: 't-burgundy', name: 'Burgundy', color: '#8c2337', visible: true },
    { id: 't-gold', name: 'Gold', color: '#d4a640', visible: true },
    { id: 't-navy', name: 'Navy', color: '#22355e', visible: true }
  ],
  felts: [
    { id: 'u-match', name: 'Match Fabric', color: 'match', visible: true },
    { id: 'u-teal', name: 'Teal Felt', color: '#2c8f94', visible: true },
    { id: 'u-burgundy', name: 'Burgundy Felt', color: '#6d1f2f', visible: true },
    { id: 'u-grey', name: 'Grey Felt', color: '#6a6d72', visible: true }
  ],
  // Style steps. "zoom" crops the live preview for each choice's thumbnail.
  steps: [
    { id: 'fabric', group: 'jacket', title: 'Fabric', desc: 'Choose the cloth for your suit. The preview shows it on the garment.', kind: 'fabric' },
    { id: 'frontButtons', group: 'jacket', title: 'Front Style', desc: 'Single or double breasted.', view: 'front', zoom: '110 40 280 440',
      choices: [
        { id: 'sb1', name: 'Single Breasted, 1 Button', price: 0, visible: true },
        { id: 'sb2', name: 'Single Breasted, 2 Buttons', price: 0, visible: true },
        { id: 'sb3', name: 'Single Breasted, 3 Buttons', price: 0, visible: true },
        { id: 'db6', name: 'Double Breasted, 6x2', price: 50, visible: true }
      ] },
    { id: 'lapelStyle', group: 'jacket', title: 'Lapel Style', desc: 'The lapel sets the character of the jacket.', view: 'front', zoom: '150 40 200 200',
      choices: [
        { id: 'notch', name: 'Notch Lapel', price: 0, visible: true },
        { id: 'peak', name: 'Peak Lapel', price: 0, visible: true },
        { id: 'shawl', name: 'Shawl Lapel', price: 0, visible: true }
      ] },
    { id: 'lapelWidth', group: 'jacket', title: 'Lapel Width', desc: 'Slim is modern, wide is classic.', view: 'front', zoom: '150 40 200 200',
      choices: [
        { id: 'slim', name: 'Slim', price: 0, visible: true },
        { id: 'standard', name: 'Standard', price: 0, visible: true },
        { id: 'wide', name: 'Wide', price: 0, visible: true }
      ] },
    { id: 'chestPocket', group: 'jacket', title: 'Chest Pocket', desc: 'Breast pocket on the left chest.', view: 'front', zoom: '270 150 110 100',
      choices: [
        { id: 'welt', name: 'Welt Pocket', price: 0, visible: true },
        { id: 'patch', name: 'Patch Pocket', price: 0, visible: true },
        { id: 'none', name: 'No Chest Pocket', price: 0, visible: true }
      ] },
    { id: 'lowerPockets', group: 'jacket', title: 'Lower Pockets', desc: 'Hip pockets on both sides.', view: 'front', zoom: '130 310 160 130',
      choices: [
        { id: 'flap', name: 'Straight Flap', price: 0, visible: true },
        { id: 'slanted', name: 'Slanted Flap', price: 0, visible: true },
        { id: 'ticket', name: 'Flap + Ticket Pocket', price: 0, visible: true },
        { id: 'jetted', name: 'Jetted (no flap)', price: 0, visible: true },
        { id: 'patch', name: 'Patch Pockets', price: 0, visible: true }
      ] },
    { id: 'vent', group: 'jacket', title: 'Back Vents', desc: 'Vents let the jacket move with you.', view: 'back', zoom: '120 300 260 180',
      choices: [
        { id: 'side', name: 'Two Side Vents', price: 0, visible: true },
        { id: 'center', name: 'Single Centre Vent', price: 0, visible: true },
        { id: 'none', name: 'No Vent', price: 0, visible: true }
      ] },
    { id: 'shoulder', group: 'jacket', title: 'Shoulder', desc: 'Soft and natural, or structured with a roped sleeve head.', view: 'front', zoom: '80 45 170 130',
      choices: [
        { id: 'natural', name: 'Natural Shoulder', price: 0, visible: true },
        { id: 'roped', name: 'Roped Shoulder', price: 0, visible: true }
      ] },
    { id: 'sleeveButtons', group: 'jacket', title: 'Sleeve Buttons', desc: 'Buttons on each cuff.', view: 'front', zoom: '76 380 60 60',
      choices: [
        { id: '3', name: '3 Buttons', price: 0, visible: true },
        { id: '4', name: '4 Kissing Buttons', price: 0, visible: true }
      ] },
    { id: 'buttons', group: 'jacket', title: 'Buttons', desc: 'Button material and colour.', kind: 'buttons' },
    { id: 'thread', group: 'jacket', title: 'Button Thread', desc: 'A contrast thread is a subtle signature.', kind: 'threads' },
    { id: 'lapelButtonhole', group: 'jacket', title: 'Lapel Buttonhole', desc: 'A buttonhole on the left lapel, for a flower or pin.', view: 'front', zoom: '260 90 110 110',
      choices: [
        { id: 'none', name: 'None', price: 0, visible: true },
        { id: 'yes', name: 'Lapel Buttonhole', price: 0, visible: true }
      ] },
    { id: 'pickStitch', group: 'jacket', title: 'Pick Stitching', desc: 'Hand-style stitching along the lapel edge.', view: 'front', zoom: '150 60 150 200',
      choices: [
        { id: 'no', name: 'No Pick Stitching', price: 0, visible: true },
        { id: 'yes', name: 'Pick Stitching', price: 25, visible: true }
      ] },
    { id: 'lining', group: 'jacket', title: 'Lining', desc: 'The inside of your jacket — have some fun here.', kind: 'linings' },
    { id: 'liningStyle', group: 'jacket', title: 'Lining Style', desc: 'Full lining, or half lining for a lighter summer jacket.', view: 'inside', zoom: '100 40 300 440',
      choices: [
        { id: 'full', name: 'Full Lining', price: 0, visible: true },
        { id: 'half', name: 'Half Lining', price: 0, visible: true }
      ] },
    { id: 'insidePockets', group: 'jacket', title: 'Inside Pockets', desc: 'Pockets inside the jacket.', view: 'inside', zoom: '140 180 120 180',
      choices: [
        { id: '1', name: '1 Inside Pocket', price: 0, visible: true },
        { id: '2', name: '2 Inside Pockets', price: 0, visible: true }
      ] },
    { id: 'felt', group: 'jacket', title: 'Under-Collar Felt', desc: 'Felt under the collar, seen when it is turned up.', kind: 'felts' },
    { id: 'monogram', group: 'jacket', title: 'Monogram', desc: 'Your initials stitched inside the jacket.', kind: 'monogram' },
    { id: 'construction', group: 'jacket', title: 'Construction', desc: 'How the jacket is built inside.', view: null,
      choices: [
        { id: 'fused', name: 'Fused', note: 'Light and affordable', price: 0, visible: true },
        { id: 'half', name: 'Half Canvas', note: 'Canvas through the chest and lapel', price: 100, visible: true },
        { id: 'full', name: 'Full Canvas', note: 'Traditional, moulds to you over time', price: 250, visible: true }
      ] },
    { id: 'pantsFabric', group: 'pants', title: 'Pants Fabric', desc: 'Match the jacket or go for a contrast.', kind: 'pantsFabric' },
    { id: 'pleats', group: 'pants', title: 'Front Pleats', desc: 'Flat front is clean; pleats add room.', view: 'pants', zoom: '130 60 240 180',
      choices: [
        { id: 'flat', name: 'Flat Front', price: 0, visible: true },
        { id: 'single', name: 'Single Pleat', price: 0, visible: true },
        { id: 'double', name: 'Double Pleat', price: 0, visible: true }
      ] },
    { id: 'waistband', group: 'pants', title: 'Waistband', desc: 'Belt loops or side adjusters (no belt needed).', view: 'pants', zoom: '120 50 260 110',
      choices: [
        { id: 'loops', name: 'Belt Loops', price: 0, visible: true },
        { id: 'adjusters', name: 'Side Adjusters', price: 20, visible: true }
      ] },
    { id: 'closure', group: 'pants', title: 'Waistband Closure', desc: 'How the front of the waistband fastens.', view: 'pants', zoom: '200 50 110 80',
      choices: [
        { id: 'standard', name: 'Standard Hidden Hook', price: 0, visible: true },
        { id: 'tab', name: 'Extended Tab + Button', price: 0, visible: true }
      ] },
    { id: 'frontPockets', group: 'pants', title: 'Front Pockets', desc: 'Side pocket style.', view: 'pants', zoom: '120 60 140 180',
      choices: [
        { id: 'slanted', name: 'Slanted Pockets', price: 0, visible: true },
        { id: 'seam', name: 'On-Seam Pockets', price: 0, visible: true }
      ] },
    { id: 'bottoms', group: 'pants', title: 'Pant Bottoms', desc: 'Plain hem or classic turn-ups.', view: 'pants', zoom: '140 730 220 140',
      choices: [
        { id: 'plain', name: 'Plain Hem', price: 0, visible: true },
        { id: 'cuffed', name: 'Cuffed (Turn-ups)', price: 0, visible: true }
      ] }
  ]
};

window.DEFAULT_CONFIG = {
  piece: 'suit',
  fabric: 'f-navy',
  frontButtons: 'sb2',
  lapelStyle: 'notch',
  lapelWidth: 'standard',
  chestPocket: 'welt',
  lowerPockets: 'flap',
  vent: 'side',
  shoulder: 'natural',
  sleeveButtons: '4',
  buttons: 'b-darkhorn',
  thread: 't-match',
  lapelButtonhole: 'yes',
  pickStitch: 'no',
  lining: 'l-teal',
  liningStyle: 'full',
  insidePockets: '2',
  felt: 'u-match',
  monogram: '',
  monogramPlace: 'pocket',
  construction: 'half',
  pantsFabric: 'same',
  pleats: 'flat',
  waistband: 'loops',
  closure: 'standard',
  frontPockets: 'slanted',
  bottoms: 'plain'
};

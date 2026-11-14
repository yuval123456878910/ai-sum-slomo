// The five sector scans. Each one runs as a separate research call.
export const SECTORS = [
  {
    id: 'plastics',
    name: 'Plastics',
    scope: 'polymers, injection molding, irrigation (drip / pipes / fittings), plastic products',
  },
  {
    id: 'food',
    name: 'Food',
    scope: 'food and beverages, food processing, refrigeration and cold storage, food raw materials',
  },
  {
    id: 'packaging',
    name: 'Packaging',
    scope: 'plastic, paper, cardboard, glass, cans, labels, industrial printing',
  },
  {
    id: 'chemicals',
    name: 'Chemicals',
    scope: 'chemicals, fertilizers, petrochemicals, cleaning products, paints, industrial cosmetics',
  },
  {
    id: 'metal',
    name: 'Metal',
    scope:
      'steel and aluminum production and processing, castings, industrial frames, metal plants, cutting and bending, coating, metal parts, profiles, metal raw materials, makers of structures and components',
  },
];

export const SECTOR_IDS = SECTORS.map((s) => s.id);
export const sectorById = (id) => SECTORS.find((s) => s.id === id);

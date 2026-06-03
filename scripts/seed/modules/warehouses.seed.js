'use strict';

/**
 * Warehouses Seed Module
 * Populates warehouses collection — 100+ fulfillment centers across India
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

// [name, code, city, stateCode, pincode, region, lat, lng, capacity, type]
const WAREHOUSES = [
  // ── METRO TIER 1 ─────────────────────────────────────────────────────────
  ['Mumbai Central DC',          'WH-MUM-01', 'Mumbai',        'MH', '400001', 'West',    19.0760, 72.8777, 100000, 'fulfillment'],
  ['Mumbai Navi Fulfilment Hub', 'WH-MUM-02', 'Navi Mumbai',   'MH', '400706', 'West',    19.0330, 73.0297, 80000,  'fulfillment'],
  ['Mumbai Bhiwandi Mega DC',    'WH-MUM-03', 'Bhiwandi',      'MH', '421302', 'West',    19.2967, 73.0582, 150000, 'mega'],
  ['Pune Logistics Park',        'WH-PUN-01', 'Pune',          'MH', '411001', 'West',    18.5204, 73.8567, 60000,  'fulfillment'],
  ['Delhi NCR DC',               'WH-DEL-01', 'New Delhi',     'DL', '110001', 'North',   28.6139, 77.2090, 120000, 'mega'],
  ['Gurgaon Fulfilment Centre',  'WH-GGN-01', 'Gurgaon',       'HR', '122001', 'North',   28.4595, 77.0266, 80000,  'fulfillment'],
  ['Noida DC',                   'WH-NOI-01', 'Noida',         'UP', '201301', 'North',   28.5355, 77.3910, 70000,  'fulfillment'],
  ['Delhi Narela Hub',           'WH-DEL-02', 'Narela',        'DL', '110040', 'North',   28.8525, 77.0996, 100000, 'mega'],
  ['Bengaluru DC',               'WH-BLR-01', 'Bengaluru',     'KA', '560001', 'South',   12.9716, 77.5946, 100000, 'fulfillment'],
  ['Bengaluru Whitefield DC',    'WH-BLR-02', 'Whitefield',    'KA', '560066', 'South',   12.9677, 77.7499, 80000,  'fulfillment'],
  ['Bengaluru Hoskote Mega',     'WH-BLR-03', 'Hoskote',       'KA', '562114', 'South',   13.0667, 77.7973, 120000, 'mega'],
  ['Chennai DC',                 'WH-CHN-01', 'Chennai',       'TN', '600001', 'South',   13.0827, 80.2707, 80000,  'fulfillment'],
  ['Chennai Sriperumbudur',      'WH-CHN-02', 'Sriperumbudur', 'TN', '602105', 'South',   12.9672, 79.9442, 100000, 'mega'],
  ['Hyderabad DC',               'WH-HYD-01', 'Hyderabad',     'TG', '500001', 'South',   17.3850, 78.4867, 80000,  'fulfillment'],
  ['Hyderabad Shamshabad',       'WH-HYD-02', 'Shamshabad',    'TG', '501218', 'South',   17.2403, 78.3969, 100000, 'mega'],
  ['Kolkata DC',                 'WH-KOL-01', 'Kolkata',       'WB', '700001', 'East',    22.5726, 88.3639, 80000,  'fulfillment'],
  ['Kolkata Dankuni Hub',        'WH-KOL-02', 'Dankuni',       'WB', '712311', 'East',    22.6140, 88.2742, 100000, 'mega'],
  ['Ahmedabad DC',               'WH-AMD-01', 'Ahmedabad',     'GJ', '380001', 'West',    23.0225, 72.5714, 80000,  'fulfillment'],
  // ── TIER 1 SUPPLEMENTARY ─────────────────────────────────────────────────
  ['Jaipur DC',                  'WH-JAI-01', 'Jaipur',        'RJ', '302001', 'North',   26.9124, 75.7873, 50000,  'fulfillment'],
  ['Lucknow DC',                 'WH-LKO-01', 'Lucknow',       'UP', '226001', 'North',   26.8467, 80.9462, 50000,  'fulfillment'],
  ['Surat DC',                   'WH-SRT-01', 'Surat',         'GJ', '395001', 'West',    21.1702, 72.8311, 50000,  'fulfillment'],
  ['Vadodara DC',                'WH-VDR-01', 'Vadodara',      'GJ', '390001', 'West',    22.3072, 73.1812, 40000,  'fulfillment'],
  // ── TIER 2 CITIES ─────────────────────────────────────────────────────────
  ['Nagpur DC',                  'WH-NGP-01', 'Nagpur',        'MH', '440001', 'Central', 21.1458, 79.0882, 40000,  'fulfillment'],
  ['Nashik DC',                  'WH-NSK-01', 'Nashik',        'MH', '422001', 'West',    20.0059, 73.7898, 30000,  'fulfillment'],
  ['Aurangabad DC',              'WH-AUR-01', 'Aurangabad',    'MH', '431001', 'West',    19.8762, 75.3433, 30000,  'fulfillment'],
  ['Patna DC',                   'WH-PAT-01', 'Patna',         'BR', '800001', 'East',    25.5941, 85.1376, 30000,  'fulfillment'],
  ['Bhopal DC',                  'WH-BPL-01', 'Bhopal',        'MP', '462001', 'Central', 23.2599, 77.4126, 40000,  'fulfillment'],
  ['Indore DC',                  'WH-IND-01', 'Indore',        'MP', '452001', 'Central', 22.7196, 75.8577, 40000,  'fulfillment'],
  ['Coimbatore DC',              'WH-CBE-01', 'Coimbatore',    'TN', '641001', 'South',   11.0168, 76.9558, 30000,  'fulfillment'],
  ['Kochi DC',                   'WH-KOC-01', 'Kochi',         'KL', '682001', 'South',    9.9312, 76.2673, 30000,  'fulfillment'],
  ['Thiruvananthapuram DC',      'WH-TVM-01', 'Thiruvananthapuram','KL','695001','South',  8.5241, 76.9366, 25000,  'fulfillment'],
  ['Guwahati DC',                'WH-GUW-01', 'Guwahati',      'AS', '781001', 'East',    26.1445, 91.7362, 25000,  'fulfillment'],
  ['Bhubaneswar DC',             'WH-BBS-01', 'Bhubaneswar',   'OD', '751001', 'East',    20.2961, 85.8189, 30000,  'fulfillment'],
  ['Raipur DC',                  'WH-RPR-01', 'Raipur',        'CG', '492001', 'Central', 21.2514, 81.6296, 30000,  'fulfillment'],
  ['Ranchi DC',                  'WH-RNC-01', 'Ranchi',        'JH', '834001', 'East',    23.3441, 85.3096, 25000,  'fulfillment'],
  ['Dehradun DC',                'WH-DDN-01', 'Dehradun',      'UK', '248001', 'North',   30.3165, 78.0322, 20000,  'fulfillment'],
  ['Chandigarh DC',              'WH-CHD-01', 'Chandigarh',    'PB', '160001', 'North',   30.7333, 76.7794, 30000,  'fulfillment'],
  ['Ludhiana DC',                'WH-LDH-01', 'Ludhiana',      'PB', '141001', 'North',   30.9010, 75.8573, 30000,  'fulfillment'],
  ['Amritsar DC',                'WH-ASR-01', 'Amritsar',      'PB', '143001', 'North',   31.6340, 74.8723, 25000,  'fulfillment'],
  ['Visakhapatnam DC',           'WH-VIZ-01', 'Visakhapatnam', 'AP', '530001', 'South',   17.6868, 83.2185, 30000,  'fulfillment'],
  ['Vijayawada DC',              'WH-VGA-01', 'Vijayawada',    'AP', '520001', 'South',   16.5062, 80.6480, 25000,  'fulfillment'],
  ['Madurai DC',                 'WH-MDU-01', 'Madurai',       'TN', '625001', 'South',    9.9252, 78.1198, 25000,  'fulfillment'],
  ['Tiruchirappalli DC',         'WH-TRZ-01', 'Tiruchirappalli','TN','620001', 'South',   10.7905, 78.7047, 20000,  'fulfillment'],
  ['Mysuru DC',                  'WH-MYS-01', 'Mysuru',        'KA', '570001', 'South',   12.2958, 76.6394, 25000,  'fulfillment'],
  ['Mangaluru DC',               'WH-MNG-01', 'Mangaluru',     'KA', '575001', 'South',   12.9141, 74.8560, 20000,  'fulfillment'],
  ['Warangal DC',                'WH-WGL-01', 'Warangal',      'TG', '506001', 'South',   17.9689, 79.5941, 20000,  'fulfillment'],
  ['Jodhpur DC',                 'WH-JDH-01', 'Jodhpur',       'RJ', '342001', 'North',   26.2389, 73.0243, 25000,  'fulfillment'],
  ['Udaipur DC',                 'WH-UDR-01', 'Udaipur',       'RJ', '313001', 'North',   24.5854, 73.7125, 20000,  'fulfillment'],
  ['Kota DC',                    'WH-KOT-01', 'Kota',          'RJ', '324001', 'North',   25.2138, 75.8648, 20000,  'fulfillment'],
  ['Agra DC',                    'WH-AGR-01', 'Agra',          'UP', '282001', 'North',   27.1767, 78.0081, 25000,  'fulfillment'],
  ['Varanasi DC',                'WH-VNS-01', 'Varanasi',      'UP', '221001', 'North',   25.3176, 82.9739, 20000,  'fulfillment'],
  ['Kanpur DC',                  'WH-KNP-01', 'Kanpur',        'UP', '208001', 'North',   26.4499, 80.3319, 30000,  'fulfillment'],
  ['Prayagraj DC',               'WH-ALH-01', 'Prayagraj',     'UP', '211001', 'North',   25.4358, 81.8463, 25000,  'fulfillment'],
  ['Ghaziabad DC',               'WH-GZB-01', 'Ghaziabad',     'UP', '201001', 'North',   28.6692, 77.4538, 40000,  'fulfillment'],
  ['Meerut DC',                  'WH-MRT-01', 'Meerut',        'UP', '250001', 'North',   28.9845, 77.7064, 25000,  'fulfillment'],
  ['Rajkot DC',                  'WH-RKT-01', 'Rajkot',        'GJ', '360001', 'West',    22.3039, 70.8022, 25000,  'fulfillment'],
  ['Bhavnagar DC',               'WH-BHV-01', 'Bhavnagar',     'GJ', '364001', 'West',    21.7645, 72.1519, 20000,  'fulfillment'],
  ['Siliguri DC',                'WH-SLG-01', 'Siliguri',      'WB', '734001', 'East',    26.7271, 88.3953, 25000,  'fulfillment'],
  ['Asansol DC',                 'WH-ASN-01', 'Asansol',       'WB', '713301', 'East',    23.6739, 86.9524, 20000,  'fulfillment'],
  ['Durgapur DC',                'WH-DGP-01', 'Durgapur',      'WB', '713201', 'East',    23.5204, 87.3119, 20000,  'fulfillment'],
  ['Jamshedpur DC',              'WH-JMP-01', 'Jamshedpur',    'JH', '831001', 'East',    22.8046, 86.2029, 25000,  'fulfillment'],
  ['Dhanbad DC',                 'WH-DHN-01', 'Dhanbad',       'JH', '826001', 'East',    23.7957, 86.4304, 20000,  'fulfillment'],
  ['Tiruchirappalli South',      'WH-TRZ-02', 'Thiruvarur',    'TN', '610001', 'South',   10.7730, 79.6340, 15000,  'spoke'],
  ['Jammu DC',                   'WH-JMU-01', 'Jammu',         'JK', '180001', 'North',   32.7266, 74.8570, 20000,  'fulfillment'],
  ['Srinagar DC',                'WH-SXR-01', 'Srinagar',      'JK', '190001', 'North',   34.0837, 74.7973, 15000,  'fulfillment'],
  ['Haridwar DC',                'WH-HRW-01', 'Haridwar',      'UK', '249401', 'North',   29.9457, 78.1642, 20000,  'fulfillment'],
  ['Ajmer DC',                   'WH-AJM-01', 'Ajmer',         'RJ', '305001', 'North',   26.4499, 74.6399, 20000,  'fulfillment'],
  // ── RETURN / SORT CENTRES ─────────────────────────────────────────────────
  ['Mumbai Sort Centre',         'SC-MUM-01', 'Mumbai',        'MH', '400080', 'West',    19.1136, 72.8697, 30000,  'sort_center'],
  ['Delhi Sort Centre',          'SC-DEL-01', 'Faridabad',     'HR', '121001', 'North',   28.4089, 77.3178, 30000,  'sort_center'],
  ['Bengaluru Sort Centre',      'SC-BLR-01', 'Bengaluru',     'KA', '562149', 'South',   12.9700, 77.5946, 25000,  'sort_center'],
  ['Chennai Sort Centre',        'SC-CHN-01', 'Chennai',       'TN', '600097', 'South',   13.0500, 80.2000, 25000,  'sort_center'],
  ['Hyderabad Sort Centre',      'SC-HYD-01', 'Hyderabad',     'TG', '500081', 'South',   17.4100, 78.4700, 25000,  'sort_center'],
  ['Kolkata Sort Centre',        'SC-KOL-01', 'Kolkata',       'WB', '700088', 'East',    22.6000, 88.4000, 20000,  'sort_center'],
  // ── COLD STORAGE ─────────────────────────────────────────────────────────
  ['Mumbai Cold Storage',        'CS-MUM-01', 'Mumbai',        'MH', '400019', 'West',    19.0200, 72.8500, 20000,  'cold_storage'],
  ['Delhi Cold Storage',         'CS-DEL-01', 'Manesar',       'HR', '122051', 'North',   28.3584, 76.9339, 20000,  'cold_storage'],
  ['Bengaluru Cold Storage',     'CS-BLR-01', 'Bengaluru',     'KA', '560100', 'South',   12.9200, 77.5500, 15000,  'cold_storage'],
];

class WarehousesSeed {
  constructor() {
    this.logger = new SeedLogger('Warehouses');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`🏭 Seeding Warehouses — ${WAREHOUSES.length} warehouses`);

    await conn.collection('warehouses').deleteMany({});

    const docs = WAREHOUSES.map(([name, code, city, stateCode, pincode, region, lat, lng, capacity, type]) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      code,
      type: type || 'fulfillment',
      managerName: `Manager ${code}`,
      managerPhone: `+91${String(Math.floor(Math.random() * 9000000000 + 1000000000))}`,
      managerEmail: `${code.toLowerCase().replace(/-/g, '.')}@warehouse.ecommerce.in`,
      address: {
        line1: `${name} Complex, Industrial Area`,
        line2: `${city}, ${stateCode}`,
        city,
        state: stateCode,
        country: 'India',
        pincode,
      },
      pincode,
      city,
      state: stateCode,
      country: 'IN',
      region,
      latitude: lat,
      longitude: lng,
      capacity,
      skuCount: 0,
      deliveryZones: [region],
      supportedCategories: [],
      isActive: true,
      active: true,
      codSupported: true,
      expressDeliverySupported: type === 'mega' || type === 'fulfillment',
      sameDayDeliverySupported: ['WH-MUM-01','WH-DEL-01','WH-BLR-01','WH-CHN-01','WH-HYD-01'].includes(code),
      standardDeliverySLA: region === 'North' || region === 'West' || region === 'South' ? 1 : 2,
      expressDeliverySLA: 1,
      operatingHours: { open: '08:00', close: '22:00', timezone: 'Asia/Kolkata' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const BATCH = 50;
    for (let i = 0; i < docs.length; i += BATCH) {
      await conn.collection('warehouses').insertMany(docs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, docs.length - i));
    }

    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = WarehousesSeed;

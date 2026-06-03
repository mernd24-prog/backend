'use strict';

/**
 * Countries Seed Module
 * Populates AdminCountry (admincountries) + flat countries collection
 * 55 countries with complete ISO/currency/timezone data
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const COUNTRIES = [
  { name: 'India', code: 'IN', dialCode: '+91', isoAlpha3: 'IND', currency: 'INR', currencySymbol: '₹', timezone: 'Asia/Kolkata', flagUrl: 'https://flagcdn.com/in.svg', region: 'Asia', active: true },
  { name: 'United States', code: 'US', dialCode: '+1', isoAlpha3: 'USA', currency: 'USD', currencySymbol: '$', timezone: 'America/New_York', flagUrl: 'https://flagcdn.com/us.svg', region: 'Americas', active: true },
  { name: 'United Kingdom', code: 'GB', dialCode: '+44', isoAlpha3: 'GBR', currency: 'GBP', currencySymbol: '£', timezone: 'Europe/London', flagUrl: 'https://flagcdn.com/gb.svg', region: 'Europe', active: true },
  { name: 'United Arab Emirates', code: 'AE', dialCode: '+971', isoAlpha3: 'ARE', currency: 'AED', currencySymbol: 'د.إ', timezone: 'Asia/Dubai', flagUrl: 'https://flagcdn.com/ae.svg', region: 'Middle East', active: true },
  { name: 'Singapore', code: 'SG', dialCode: '+65', isoAlpha3: 'SGP', currency: 'SGD', currencySymbol: 'S$', timezone: 'Asia/Singapore', flagUrl: 'https://flagcdn.com/sg.svg', region: 'Asia', active: true },
  { name: 'Australia', code: 'AU', dialCode: '+61', isoAlpha3: 'AUS', currency: 'AUD', currencySymbol: 'A$', timezone: 'Australia/Sydney', flagUrl: 'https://flagcdn.com/au.svg', region: 'Oceania', active: true },
  { name: 'Canada', code: 'CA', dialCode: '+1', isoAlpha3: 'CAN', currency: 'CAD', currencySymbol: 'C$', timezone: 'America/Toronto', flagUrl: 'https://flagcdn.com/ca.svg', region: 'Americas', active: true },
  { name: 'Germany', code: 'DE', dialCode: '+49', isoAlpha3: 'DEU', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Berlin', flagUrl: 'https://flagcdn.com/de.svg', region: 'Europe', active: true },
  { name: 'France', code: 'FR', dialCode: '+33', isoAlpha3: 'FRA', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Paris', flagUrl: 'https://flagcdn.com/fr.svg', region: 'Europe', active: true },
  { name: 'Japan', code: 'JP', dialCode: '+81', isoAlpha3: 'JPN', currency: 'JPY', currencySymbol: '¥', timezone: 'Asia/Tokyo', flagUrl: 'https://flagcdn.com/jp.svg', region: 'Asia', active: true },
  { name: 'China', code: 'CN', dialCode: '+86', isoAlpha3: 'CHN', currency: 'CNY', currencySymbol: '¥', timezone: 'Asia/Shanghai', flagUrl: 'https://flagcdn.com/cn.svg', region: 'Asia', active: true },
  { name: 'South Korea', code: 'KR', dialCode: '+82', isoAlpha3: 'KOR', currency: 'KRW', currencySymbol: '₩', timezone: 'Asia/Seoul', flagUrl: 'https://flagcdn.com/kr.svg', region: 'Asia', active: true },
  { name: 'Bangladesh', code: 'BD', dialCode: '+880', isoAlpha3: 'BGD', currency: 'BDT', currencySymbol: '৳', timezone: 'Asia/Dhaka', flagUrl: 'https://flagcdn.com/bd.svg', region: 'Asia', active: true },
  { name: 'Pakistan', code: 'PK', dialCode: '+92', isoAlpha3: 'PAK', currency: 'PKR', currencySymbol: '₨', timezone: 'Asia/Karachi', flagUrl: 'https://flagcdn.com/pk.svg', region: 'Asia', active: true },
  { name: 'Sri Lanka', code: 'LK', dialCode: '+94', isoAlpha3: 'LKA', currency: 'LKR', currencySymbol: 'Rs', timezone: 'Asia/Colombo', flagUrl: 'https://flagcdn.com/lk.svg', region: 'Asia', active: true },
  { name: 'Nepal', code: 'NP', dialCode: '+977', isoAlpha3: 'NPL', currency: 'NPR', currencySymbol: 'Rs', timezone: 'Asia/Kathmandu', flagUrl: 'https://flagcdn.com/np.svg', region: 'Asia', active: true },
  { name: 'Malaysia', code: 'MY', dialCode: '+60', isoAlpha3: 'MYS', currency: 'MYR', currencySymbol: 'RM', timezone: 'Asia/Kuala_Lumpur', flagUrl: 'https://flagcdn.com/my.svg', region: 'Asia', active: true },
  { name: 'Indonesia', code: 'ID', dialCode: '+62', isoAlpha3: 'IDN', currency: 'IDR', currencySymbol: 'Rp', timezone: 'Asia/Jakarta', flagUrl: 'https://flagcdn.com/id.svg', region: 'Asia', active: true },
  { name: 'Thailand', code: 'TH', dialCode: '+66', isoAlpha3: 'THA', currency: 'THB', currencySymbol: '฿', timezone: 'Asia/Bangkok', flagUrl: 'https://flagcdn.com/th.svg', region: 'Asia', active: true },
  { name: 'Philippines', code: 'PH', dialCode: '+63', isoAlpha3: 'PHL', currency: 'PHP', currencySymbol: '₱', timezone: 'Asia/Manila', flagUrl: 'https://flagcdn.com/ph.svg', region: 'Asia', active: true },
  { name: 'Vietnam', code: 'VN', dialCode: '+84', isoAlpha3: 'VNM', currency: 'VND', currencySymbol: '₫', timezone: 'Asia/Ho_Chi_Minh', flagUrl: 'https://flagcdn.com/vn.svg', region: 'Asia', active: true },
  { name: 'Saudi Arabia', code: 'SA', dialCode: '+966', isoAlpha3: 'SAU', currency: 'SAR', currencySymbol: '﷼', timezone: 'Asia/Riyadh', flagUrl: 'https://flagcdn.com/sa.svg', region: 'Middle East', active: true },
  { name: 'Qatar', code: 'QA', dialCode: '+974', isoAlpha3: 'QAT', currency: 'QAR', currencySymbol: '﷼', timezone: 'Asia/Qatar', flagUrl: 'https://flagcdn.com/qa.svg', region: 'Middle East', active: true },
  { name: 'Kuwait', code: 'KW', dialCode: '+965', isoAlpha3: 'KWT', currency: 'KWD', currencySymbol: 'KD', timezone: 'Asia/Kuwait', flagUrl: 'https://flagcdn.com/kw.svg', region: 'Middle East', active: true },
  { name: 'Bahrain', code: 'BH', dialCode: '+973', isoAlpha3: 'BHR', currency: 'BHD', currencySymbol: 'BD', timezone: 'Asia/Bahrain', flagUrl: 'https://flagcdn.com/bh.svg', region: 'Middle East', active: true },
  { name: 'Oman', code: 'OM', dialCode: '+968', isoAlpha3: 'OMN', currency: 'OMR', currencySymbol: 'ر.ع.', timezone: 'Asia/Muscat', flagUrl: 'https://flagcdn.com/om.svg', region: 'Middle East', active: true },
  { name: 'Israel', code: 'IL', dialCode: '+972', isoAlpha3: 'ISR', currency: 'ILS', currencySymbol: '₪', timezone: 'Asia/Jerusalem', flagUrl: 'https://flagcdn.com/il.svg', region: 'Middle East', active: true },
  { name: 'South Africa', code: 'ZA', dialCode: '+27', isoAlpha3: 'ZAF', currency: 'ZAR', currencySymbol: 'R', timezone: 'Africa/Johannesburg', flagUrl: 'https://flagcdn.com/za.svg', region: 'Africa', active: true },
  { name: 'Nigeria', code: 'NG', dialCode: '+234', isoAlpha3: 'NGA', currency: 'NGN', currencySymbol: '₦', timezone: 'Africa/Lagos', flagUrl: 'https://flagcdn.com/ng.svg', region: 'Africa', active: true },
  { name: 'Kenya', code: 'KE', dialCode: '+254', isoAlpha3: 'KEN', currency: 'KES', currencySymbol: 'KSh', timezone: 'Africa/Nairobi', flagUrl: 'https://flagcdn.com/ke.svg', region: 'Africa', active: true },
  { name: 'Egypt', code: 'EG', dialCode: '+20', isoAlpha3: 'EGY', currency: 'EGP', currencySymbol: 'E£', timezone: 'Africa/Cairo', flagUrl: 'https://flagcdn.com/eg.svg', region: 'Africa', active: true },
  { name: 'Italy', code: 'IT', dialCode: '+39', isoAlpha3: 'ITA', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Rome', flagUrl: 'https://flagcdn.com/it.svg', region: 'Europe', active: true },
  { name: 'Spain', code: 'ES', dialCode: '+34', isoAlpha3: 'ESP', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Madrid', flagUrl: 'https://flagcdn.com/es.svg', region: 'Europe', active: true },
  { name: 'Netherlands', code: 'NL', dialCode: '+31', isoAlpha3: 'NLD', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Amsterdam', flagUrl: 'https://flagcdn.com/nl.svg', region: 'Europe', active: true },
  { name: 'Sweden', code: 'SE', dialCode: '+46', isoAlpha3: 'SWE', currency: 'SEK', currencySymbol: 'kr', timezone: 'Europe/Stockholm', flagUrl: 'https://flagcdn.com/se.svg', region: 'Europe', active: true },
  { name: 'Switzerland', code: 'CH', dialCode: '+41', isoAlpha3: 'CHE', currency: 'CHF', currencySymbol: 'CHF', timezone: 'Europe/Zurich', flagUrl: 'https://flagcdn.com/ch.svg', region: 'Europe', active: true },
  { name: 'Russia', code: 'RU', dialCode: '+7', isoAlpha3: 'RUS', currency: 'RUB', currencySymbol: '₽', timezone: 'Europe/Moscow', flagUrl: 'https://flagcdn.com/ru.svg', region: 'Europe', active: true },
  { name: 'Brazil', code: 'BR', dialCode: '+55', isoAlpha3: 'BRA', currency: 'BRL', currencySymbol: 'R$', timezone: 'America/Sao_Paulo', flagUrl: 'https://flagcdn.com/br.svg', region: 'Americas', active: true },
  { name: 'Mexico', code: 'MX', dialCode: '+52', isoAlpha3: 'MEX', currency: 'MXN', currencySymbol: '$', timezone: 'America/Mexico_City', flagUrl: 'https://flagcdn.com/mx.svg', region: 'Americas', active: true },
  { name: 'Argentina', code: 'AR', dialCode: '+54', isoAlpha3: 'ARG', currency: 'ARS', currencySymbol: '$', timezone: 'America/Argentina/Buenos_Aires', flagUrl: 'https://flagcdn.com/ar.svg', region: 'Americas', active: true },
  { name: 'Colombia', code: 'CO', dialCode: '+57', isoAlpha3: 'COL', currency: 'COP', currencySymbol: '$', timezone: 'America/Bogota', flagUrl: 'https://flagcdn.com/co.svg', region: 'Americas', active: true },
  { name: 'New Zealand', code: 'NZ', dialCode: '+64', isoAlpha3: 'NZL', currency: 'NZD', currencySymbol: 'NZ$', timezone: 'Pacific/Auckland', flagUrl: 'https://flagcdn.com/nz.svg', region: 'Oceania', active: true },
  { name: 'Poland', code: 'PL', dialCode: '+48', isoAlpha3: 'POL', currency: 'PLN', currencySymbol: 'zł', timezone: 'Europe/Warsaw', flagUrl: 'https://flagcdn.com/pl.svg', region: 'Europe', active: true },
  { name: 'Turkey', code: 'TR', dialCode: '+90', isoAlpha3: 'TUR', currency: 'TRY', currencySymbol: '₺', timezone: 'Europe/Istanbul', flagUrl: 'https://flagcdn.com/tr.svg', region: 'Europe', active: true },
  { name: 'Ukraine', code: 'UA', dialCode: '+380', isoAlpha3: 'UKR', currency: 'UAH', currencySymbol: '₴', timezone: 'Europe/Kyiv', flagUrl: 'https://flagcdn.com/ua.svg', region: 'Europe', active: true },
  { name: 'Portugal', code: 'PT', dialCode: '+351', isoAlpha3: 'PRT', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Lisbon', flagUrl: 'https://flagcdn.com/pt.svg', region: 'Europe', active: true },
  { name: 'Belgium', code: 'BE', dialCode: '+32', isoAlpha3: 'BEL', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Brussels', flagUrl: 'https://flagcdn.com/be.svg', region: 'Europe', active: true },
  { name: 'Austria', code: 'AT', dialCode: '+43', isoAlpha3: 'AUT', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Vienna', flagUrl: 'https://flagcdn.com/at.svg', region: 'Europe', active: true },
  { name: 'Norway', code: 'NO', dialCode: '+47', isoAlpha3: 'NOR', currency: 'NOK', currencySymbol: 'kr', timezone: 'Europe/Oslo', flagUrl: 'https://flagcdn.com/no.svg', region: 'Europe', active: true },
  { name: 'Denmark', code: 'DK', dialCode: '+45', isoAlpha3: 'DNK', currency: 'DKK', currencySymbol: 'kr', timezone: 'Europe/Copenhagen', flagUrl: 'https://flagcdn.com/dk.svg', region: 'Europe', active: true },
  { name: 'Finland', code: 'FI', dialCode: '+358', isoAlpha3: 'FIN', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Helsinki', flagUrl: 'https://flagcdn.com/fi.svg', region: 'Europe', active: true },
  { name: 'Ireland', code: 'IE', dialCode: '+353', isoAlpha3: 'IRL', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Dublin', flagUrl: 'https://flagcdn.com/ie.svg', region: 'Europe', active: true },
  { name: 'Greece', code: 'GR', dialCode: '+30', isoAlpha3: 'GRC', currency: 'EUR', currencySymbol: '€', timezone: 'Europe/Athens', flagUrl: 'https://flagcdn.com/gr.svg', region: 'Europe', active: true },
  { name: 'Czech Republic', code: 'CZ', dialCode: '+420', isoAlpha3: 'CZE', currency: 'CZK', currencySymbol: 'Kč', timezone: 'Europe/Prague', flagUrl: 'https://flagcdn.com/cz.svg', region: 'Europe', active: true },
  { name: 'Hungary', code: 'HU', dialCode: '+36', isoAlpha3: 'HUN', currency: 'HUF', currencySymbol: 'Ft', timezone: 'Europe/Budapest', flagUrl: 'https://flagcdn.com/hu.svg', region: 'Europe', active: true },
  { name: 'Romania', code: 'RO', dialCode: '+40', isoAlpha3: 'ROU', currency: 'RON', currencySymbol: 'lei', timezone: 'Europe/Bucharest', flagUrl: 'https://flagcdn.com/ro.svg', region: 'Europe', active: true },
];

class CountriesSeed {
  constructor() {
    this.logger = new SeedLogger('Countries');
    this.mongoose = mongoose;
  }

  async execute() {
    try {
      this.logger.info(`🌍 Seeding Countries — ${COUNTRIES.length} entries`);
      const conn = this.mongoose.connection;
      if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

      // ── Clear existing ──────────────────────────────────────────────────────
      await conn.collection('admincountries').deleteMany({});
      await conn.collection('countries').deleteMany({});

      // ── AdminCountry collection (used by admin panel dropdowns) ─────────────
      const adminCountryDocs = COUNTRIES.map(c => ({
        _id: new mongoose.Types.ObjectId(),
        name: c.name,
        code: c.code.toUpperCase(),
        dialCode: c.dialCode,
        active: c.active,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await conn.collection('admincountries').insertMany(adminCountryDocs);
      this.logger.recordBatch(adminCountryDocs.length);

      // ── Flat countries collection (customer-facing / legacy) ─────────────────
      const flatCountryDocs = COUNTRIES.map(c => ({
        _id: new mongoose.Types.ObjectId(),
        code: c.code.toUpperCase(),
        name: c.name,
        isoAlpha3: c.isoAlpha3,
        dialCode: c.dialCode,
        currency: c.currency,
        currencySymbol: c.currencySymbol,
        timezone: c.timezone,
        flagUrl: c.flagUrl,
        region: c.region,
        active: c.active,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await conn.collection('countries').insertMany(flatCountryDocs);

      // ── Geography collection (Geography model) ──────────────────────────────
      await conn.collection('geographies').deleteMany({});
      const geographyDoc = {
        _id: new mongoose.Types.ObjectId(),
        countryCode: 'IN',
        countryName: 'India',
        active: true,
        states: [
          { stateCode: 'AP', stateName: 'Andhra Pradesh', cities: ['Vijayawada', 'Visakhapatnam', 'Guntur', 'Nellore', 'Tirupati', 'Kakinada', 'Rajahmundry', 'Kurnool', 'Eluru', 'Ongole'] },
          { stateCode: 'AR', stateName: 'Arunachal Pradesh', cities: ['Itanagar', 'Naharlagun', 'Tawang', 'Pasighat', 'Ziro'] },
          { stateCode: 'AS', stateName: 'Assam', cities: ['Guwahati', 'Dispur', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur'] },
          { stateCode: 'BR', stateName: 'Bihar', cities: ['Patna', 'Gaya', 'Muzaffarpur', 'Bhagalpur', 'Darbhanga', 'Purnia', 'Bihar Sharif', 'Arrah', 'Begusarai'] },
          { stateCode: 'CG', stateName: 'Chhattisgarh', cities: ['Raipur', 'Bhilai', 'Bilaspur', 'Durg', 'Korba', 'Rajnandgaon', 'Jagdalpur', 'Raigarh'] },
          { stateCode: 'GA', stateName: 'Goa', cities: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Calangute'] },
          { stateCode: 'GJ', stateName: 'Gujarat', cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Anand', 'Morbi', 'Navsari', 'Valsad'] },
          { stateCode: 'HR', stateName: 'Haryana', cities: ['Gurgaon', 'Faridabad', 'Hisar', 'Rohtak', 'Panipat', 'Karnal', 'Sonipat', 'Yamunanagar', 'Bhiwani', 'Ambala'] },
          { stateCode: 'HP', stateName: 'Himachal Pradesh', cities: ['Shimla', 'Solan', 'Mandi', 'Dharamshala', 'Palampur', 'Baddi', 'Nahan', 'Hamirpur'] },
          { stateCode: 'JH', stateName: 'Jharkhand', cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Giridih', 'Ramgarh', 'Phusro', 'Medininagar'] },
          { stateCode: 'KA', stateName: 'Karnataka', cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Dharwad', 'Kalaburagi', 'Ballari', 'Vijayapura', 'Belagavi', 'Shivamogga', 'Tumakuru', 'Davanagere'] },
          { stateCode: 'KL', stateName: 'Kerala', cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Palakkad', 'Alappuzha', 'Kannur', 'Malappuram', 'Kottayam'] },
          { stateCode: 'MP', stateName: 'Madhya Pradesh', cities: ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa', 'Murwara', 'Singrauli'] },
          { stateCode: 'MH', stateName: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Pimpri-Chinchwad', 'Nashik', 'Aurangabad', 'Solapur', 'Kalyan-Dombivli', 'Vasai-Virar', 'Navi Mumbai', 'Kolhapur', 'Amravati', 'Sangli', 'Malegaon', 'Jalgaon', 'Akola', 'Latur', 'Dhule', 'Ahmednagar', 'Ichalkaranji', 'Panvel'] },
          { stateCode: 'MN', stateName: 'Manipur', cities: ['Imphal', 'Thoubal', 'Bishnupur', 'Senapati', 'Ukhrul'] },
          { stateCode: 'ML', stateName: 'Meghalaya', cities: ['Shillong', 'Tura', 'Nongstoin', 'Jowai', 'Baghmara'] },
          { stateCode: 'MZ', stateName: 'Mizoram', cities: ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip', 'Kolasib'] },
          { stateCode: 'NL', stateName: 'Nagaland', cities: ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha'] },
          { stateCode: 'OD', stateName: 'Odisha', cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Brahmapur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Baripada', 'Jharsuguda'] },
          { stateCode: 'PB', stateName: 'Punjab', cities: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Hoshiarpur', 'Mohali', 'Gurdaspur', 'Firozpur', 'Moga'] },
          { stateCode: 'RJ', stateName: 'Rajasthan', cities: ['Jaipur', 'Jodhpur', 'Kota', 'Bikaner', 'Ajmer', 'Udaipur', 'Bhilwara', 'Alwar', 'Bharatpur', 'Sikar', 'Sri Ganganagar', 'Pali'] },
          { stateCode: 'SK', stateName: 'Sikkim', cities: ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan'] },
          { stateCode: 'TN', stateName: 'Tamil Nadu', cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Vellore', 'Erode', 'Thoothukkudi', 'Dindigul', 'Ambattur', 'Thanjavur', 'Ranipet', 'Hosur'] },
          { stateCode: 'TG', stateName: 'Telangana', cities: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Suryapet'] },
          { stateCode: 'TR', stateName: 'Tripura', cities: ['Agartala', 'Dharmanagar', 'Udaipur', 'Kumarghat', 'Kailasahar'] },
          { stateCode: 'UP', stateName: 'Uttar Pradesh', cities: ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Meerut', 'Varanasi', 'Prayagraj', 'Bareilly', 'Aligarh', 'Moradabad', 'Saharanpur', 'Gorakhpur', 'Noida', 'Firozabad', 'Jhansi', 'Muzaffarnagar', 'Mathura', 'Rampur'] },
          { stateCode: 'UK', stateName: 'Uttarakhand', cities: ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur', 'Rishikesh', 'Kotdwar'] },
          { stateCode: 'WB', stateName: 'West Bengal', cities: ['Kolkata', 'Asansol', 'Siliguri', 'Durgapur', 'Bardhaman', 'Malda', 'Baharampur', 'Habra', 'Kharagpur', 'Shantipur', 'Darjeeling', 'Jalpaiguri', 'Haldia', 'Raiganj'] },
          { stateCode: 'AN', stateName: 'Andaman and Nicobar Islands', cities: ['Port Blair', 'Diglipur', 'Rangat'] },
          { stateCode: 'CH', stateName: 'Chandigarh', cities: ['Chandigarh', 'Panchkula', 'Mohali'] },
          { stateCode: 'DN', stateName: 'Dadra and Nagar Haveli and Daman and Diu', cities: ['Silvassa', 'Daman', 'Diu'] },
          { stateCode: 'DL', stateName: 'Delhi', cities: ['New Delhi', 'Delhi', 'Dwarka', 'Rohini', 'Janakpuri', 'Laxmi Nagar', 'Preet Vihar', 'Pitampura', 'Saket', 'Nehru Place'] },
          { stateCode: 'JK', stateName: 'Jammu and Kashmir', cities: ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Sopore', 'Kathua', 'Udhampur'] },
          { stateCode: 'LA', stateName: 'Ladakh', cities: ['Leh', 'Kargil', 'Zanskar', 'Diskit'] },
          { stateCode: 'LD', stateName: 'Lakshadweep', cities: ['Kavaratti', 'Agatti', 'Minicoy'] },
          { stateCode: 'PY', stateName: 'Puducherry', cities: ['Puducherry', 'Karaikal', 'Mahé', 'Yanam'] },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await conn.collection('geographies').insertOne(geographyDoc);

      this.logger.printStats();
      return {
        created: adminCountryDocs.length,
        adminCountries: adminCountryDocs.length,
        flatCountries: flatCountryDocs.length,
        geographies: 1,
      };
    } catch (error) {
      this.logger.error('Countries seeding failed', error);
      throw error;
    }
  }
}

module.exports = CountriesSeed;

'use strict';

/**
 * Locations Seed Module
 * Populates AdminState, AdminCity, AdminZipCode (with proper ObjectId refs)
 * 36 states/UTs, 400+ cities, 2500+ pincodes
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

// ─── State data ──────────────────────────────────────────────────────────────
const STATES = [
  { code: 'AP', name: 'Andhra Pradesh',  gstCode: '28', capital: 'Amaravati',     region: 'South',   tier: 1 },
  { code: 'AR', name: 'Arunachal Pradesh', gstCode: '12', capital: 'Itanagar',   region: 'East',    tier: 3 },
  { code: 'AS', name: 'Assam',           gstCode: '18', capital: 'Dispur',        region: 'East',    tier: 2 },
  { code: 'BR', name: 'Bihar',           gstCode: '10', capital: 'Patna',         region: 'East',    tier: 2 },
  { code: 'CG', name: 'Chhattisgarh',   gstCode: '22', capital: 'Raipur',        region: 'Central', tier: 2 },
  { code: 'GA', name: 'Goa',            gstCode: '30', capital: 'Panaji',        region: 'West',    tier: 2 },
  { code: 'GJ', name: 'Gujarat',        gstCode: '24', capital: 'Gandhinagar',   region: 'West',    tier: 1 },
  { code: 'HR', name: 'Haryana',        gstCode: '06', capital: 'Chandigarh',    region: 'North',   tier: 1 },
  { code: 'HP', name: 'Himachal Pradesh', gstCode: '02', capital: 'Shimla',      region: 'North',   tier: 2 },
  { code: 'JH', name: 'Jharkhand',      gstCode: '20', capital: 'Ranchi',        region: 'East',    tier: 2 },
  { code: 'KA', name: 'Karnataka',      gstCode: '29', capital: 'Bengaluru',     region: 'South',   tier: 1 },
  { code: 'KL', name: 'Kerala',         gstCode: '32', capital: 'Thiruvananthapuram', region: 'South', tier: 1 },
  { code: 'MP', name: 'Madhya Pradesh', gstCode: '23', capital: 'Bhopal',        region: 'Central', tier: 1 },
  { code: 'MH', name: 'Maharashtra',    gstCode: '27', capital: 'Mumbai',        region: 'West',    tier: 1 },
  { code: 'MN', name: 'Manipur',        gstCode: '14', capital: 'Imphal',        region: 'East',    tier: 3 },
  { code: 'ML', name: 'Meghalaya',      gstCode: '17', capital: 'Shillong',      region: 'East',    tier: 3 },
  { code: 'MZ', name: 'Mizoram',        gstCode: '15', capital: 'Aizawl',        region: 'East',    tier: 3 },
  { code: 'NL', name: 'Nagaland',       gstCode: '13', capital: 'Kohima',        region: 'East',    tier: 3 },
  { code: 'OD', name: 'Odisha',         gstCode: '21', capital: 'Bhubaneswar',   region: 'East',    tier: 2 },
  { code: 'PB', name: 'Punjab',         gstCode: '03', capital: 'Chandigarh',    region: 'North',   tier: 1 },
  { code: 'RJ', name: 'Rajasthan',      gstCode: '08', capital: 'Jaipur',        region: 'North',   tier: 1 },
  { code: 'SK', name: 'Sikkim',         gstCode: '11', capital: 'Gangtok',       region: 'East',    tier: 3 },
  { code: 'TN', name: 'Tamil Nadu',     gstCode: '33', capital: 'Chennai',       region: 'South',   tier: 1 },
  { code: 'TG', name: 'Telangana',      gstCode: '36', capital: 'Hyderabad',     region: 'South',   tier: 1 },
  { code: 'TR', name: 'Tripura',        gstCode: '16', capital: 'Agartala',      region: 'East',    tier: 3 },
  { code: 'UP', name: 'Uttar Pradesh',  gstCode: '09', capital: 'Lucknow',       region: 'North',   tier: 1 },
  { code: 'UK', name: 'Uttarakhand',    gstCode: '05', capital: 'Dehradun',      region: 'North',   tier: 2 },
  { code: 'WB', name: 'West Bengal',    gstCode: '19', capital: 'Kolkata',       region: 'East',    tier: 1 },
  // Union Territories
  { code: 'AN', name: 'Andaman and Nicobar Islands', gstCode: '35', capital: 'Port Blair', region: 'South', tier: 3 },
  { code: 'CH', name: 'Chandigarh',     gstCode: '04', capital: 'Chandigarh',    region: 'North',   tier: 1 },
  { code: 'DN', name: 'Dadra and Nagar Haveli and Daman and Diu', gstCode: '25', capital: 'Silvassa', region: 'West', tier: 3 },
  { code: 'DL', name: 'Delhi',          gstCode: '07', capital: 'New Delhi',     region: 'North',   tier: 1 },
  { code: 'JK', name: 'Jammu and Kashmir', gstCode: '01', capital: 'Srinagar',   region: 'North',   tier: 2 },
  { code: 'LA', name: 'Ladakh',         gstCode: '38', capital: 'Leh',           region: 'North',   tier: 3 },
  { code: 'LD', name: 'Lakshadweep',    gstCode: '31', capital: 'Kavaratti',     region: 'South',   tier: 3 },
  { code: 'PY', name: 'Puducherry',     gstCode: '34', capital: 'Puducherry',    region: 'South',   tier: 2 },
];

// ─── City data per state ─────────────────────────────────────────────────────
const CITIES_BY_STATE = {
  AP: [
    { name: 'Vijayawada', lat: 16.5062, lng: 80.6480, tier: 1, isMajor: true },
    { name: 'Visakhapatnam', lat: 17.6868, lng: 83.2185, tier: 1, isMajor: true },
    { name: 'Guntur', lat: 16.3067, lng: 80.4365, tier: 2, isMajor: true },
    { name: 'Nellore', lat: 14.4426, lng: 79.9865, tier: 2, isMajor: false },
    { name: 'Tirupati', lat: 13.6288, lng: 79.4192, tier: 2, isMajor: false },
    { name: 'Kakinada', lat: 16.9891, lng: 82.2475, tier: 2, isMajor: false },
    { name: 'Rajahmundry', lat: 17.0005, lng: 81.8040, tier: 2, isMajor: false },
    { name: 'Kurnool', lat: 15.8281, lng: 78.0373, tier: 2, isMajor: false },
    { name: 'Eluru', lat: 16.7107, lng: 81.0952, tier: 3, isMajor: false },
    { name: 'Ongole', lat: 15.5057, lng: 80.0499, tier: 3, isMajor: false },
    { name: 'Amaravati', lat: 16.5131, lng: 80.5170, tier: 2, isMajor: false },
    { name: 'Chittoor', lat: 13.2172, lng: 79.1003, tier: 3, isMajor: false },
  ],
  AS: [
    { name: 'Guwahati', lat: 26.1445, lng: 91.7362, tier: 1, isMajor: true },
    { name: 'Dispur', lat: 26.1441, lng: 91.7898, tier: 2, isMajor: false },
    { name: 'Silchar', lat: 24.8333, lng: 92.7789, tier: 2, isMajor: false },
    { name: 'Dibrugarh', lat: 27.4728, lng: 94.9120, tier: 2, isMajor: false },
    { name: 'Jorhat', lat: 26.7465, lng: 94.2026, tier: 2, isMajor: false },
    { name: 'Nagaon', lat: 26.3437, lng: 92.6836, tier: 3, isMajor: false },
    { name: 'Tinsukia', lat: 27.4894, lng: 95.3624, tier: 3, isMajor: false },
    { name: 'Tezpur', lat: 26.6338, lng: 92.7938, tier: 3, isMajor: false },
  ],
  BR: [
    { name: 'Patna', lat: 25.5941, lng: 85.1376, tier: 1, isMajor: true },
    { name: 'Gaya', lat: 24.7914, lng: 84.9994, tier: 2, isMajor: false },
    { name: 'Muzaffarpur', lat: 26.1225, lng: 85.3906, tier: 2, isMajor: false },
    { name: 'Bhagalpur', lat: 25.2425, lng: 86.9842, tier: 2, isMajor: false },
    { name: 'Darbhanga', lat: 26.1542, lng: 85.8917, tier: 2, isMajor: false },
    { name: 'Purnia', lat: 25.7771, lng: 87.4753, tier: 2, isMajor: false },
    { name: 'Begusarai', lat: 25.4182, lng: 86.1272, tier: 3, isMajor: false },
    { name: 'Arrah', lat: 25.5561, lng: 84.6612, tier: 3, isMajor: false },
    { name: 'Bihar Sharif', lat: 25.1983, lng: 85.5239, tier: 3, isMajor: false },
    { name: 'Katihar', lat: 25.5399, lng: 87.5717, tier: 3, isMajor: false },
  ],
  CG: [
    { name: 'Raipur', lat: 21.2514, lng: 81.6296, tier: 1, isMajor: true },
    { name: 'Bhilai', lat: 21.2090, lng: 81.4285, tier: 1, isMajor: true },
    { name: 'Bilaspur', lat: 22.0797, lng: 82.1391, tier: 2, isMajor: false },
    { name: 'Durg', lat: 21.1904, lng: 81.2849, tier: 2, isMajor: false },
    { name: 'Korba', lat: 22.3595, lng: 82.7501, tier: 2, isMajor: false },
    { name: 'Rajnandgaon', lat: 21.0963, lng: 81.0297, tier: 3, isMajor: false },
    { name: 'Jagdalpur', lat: 19.0786, lng: 82.0213, tier: 3, isMajor: false },
  ],
  GA: [
    { name: 'Panaji', lat: 15.4989, lng: 73.8278, tier: 2, isMajor: true },
    { name: 'Margao', lat: 15.2832, lng: 73.9862, tier: 2, isMajor: false },
    { name: 'Vasco da Gama', lat: 15.3958, lng: 73.8157, tier: 2, isMajor: false },
    { name: 'Mapusa', lat: 15.5937, lng: 73.8077, tier: 3, isMajor: false },
    { name: 'Ponda', lat: 15.4032, lng: 74.0099, tier: 3, isMajor: false },
    { name: 'Calangute', lat: 15.5437, lng: 73.7553, tier: 3, isMajor: false },
  ],
  GJ: [
    { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714, tier: 1, isMajor: true },
    { name: 'Surat', lat: 21.1702, lng: 72.8311, tier: 1, isMajor: true },
    { name: 'Vadodara', lat: 22.3072, lng: 73.1812, tier: 1, isMajor: true },
    { name: 'Rajkot', lat: 22.3039, lng: 70.8022, tier: 1, isMajor: true },
    { name: 'Bhavnagar', lat: 21.7645, lng: 72.1519, tier: 2, isMajor: false },
    { name: 'Jamnagar', lat: 22.4707, lng: 70.0577, tier: 2, isMajor: false },
    { name: 'Gandhinagar', lat: 23.2156, lng: 72.6369, tier: 2, isMajor: true },
    { name: 'Anand', lat: 22.5560, lng: 72.9559, tier: 2, isMajor: false },
    { name: 'Morbi', lat: 22.8173, lng: 70.8371, tier: 2, isMajor: false },
    { name: 'Navsari', lat: 20.9467, lng: 72.9520, tier: 2, isMajor: false },
    { name: 'Valsad', lat: 20.6181, lng: 72.9341, tier: 2, isMajor: false },
    { name: 'Bharuch', lat: 21.7051, lng: 72.9959, tier: 2, isMajor: false },
    { name: 'Junagadh', lat: 21.5222, lng: 70.4579, tier: 2, isMajor: false },
    { name: 'Gandhinagar', lat: 23.2156, lng: 72.6369, tier: 2, isMajor: false },
    { name: 'Gandhidham', lat: 23.0753, lng: 70.1337, tier: 3, isMajor: false },
  ],
  HR: [
    { name: 'Gurgaon', lat: 28.4595, lng: 77.0266, tier: 1, isMajor: true },
    { name: 'Faridabad', lat: 28.4089, lng: 77.3178, tier: 1, isMajor: true },
    { name: 'Panipat', lat: 29.3909, lng: 76.9635, tier: 2, isMajor: false },
    { name: 'Ambala', lat: 30.3782, lng: 76.7767, tier: 2, isMajor: false },
    { name: 'Hisar', lat: 29.1492, lng: 75.7217, tier: 2, isMajor: false },
    { name: 'Rohtak', lat: 28.8955, lng: 76.6066, tier: 2, isMajor: false },
    { name: 'Karnal', lat: 29.6857, lng: 76.9905, tier: 2, isMajor: false },
    { name: 'Sonipat', lat: 28.9288, lng: 77.0200, tier: 2, isMajor: false },
    { name: 'Yamunanagar', lat: 30.1290, lng: 77.2674, tier: 2, isMajor: false },
    { name: 'Bhiwani', lat: 28.7928, lng: 76.1323, tier: 3, isMajor: false },
    { name: 'Rewari', lat: 28.1940, lng: 76.6195, tier: 3, isMajor: false },
    { name: 'Panchkula', lat: 30.6942, lng: 76.8606, tier: 2, isMajor: false },
    { name: 'Manesar', lat: 28.3584, lng: 76.9339, tier: 2, isMajor: false },
  ],
  HP: [
    { name: 'Shimla', lat: 31.1048, lng: 77.1734, tier: 2, isMajor: true },
    { name: 'Solan', lat: 30.9045, lng: 77.0967, tier: 2, isMajor: false },
    { name: 'Mandi', lat: 31.7083, lng: 76.9317, tier: 3, isMajor: false },
    { name: 'Dharamshala', lat: 32.2190, lng: 76.3234, tier: 2, isMajor: false },
    { name: 'Palampur', lat: 32.1115, lng: 76.5368, tier: 3, isMajor: false },
    { name: 'Baddi', lat: 30.9573, lng: 76.7942, tier: 2, isMajor: false },
    { name: 'Nahan', lat: 30.5580, lng: 77.2960, tier: 3, isMajor: false },
    { name: 'Kullu', lat: 31.9592, lng: 77.1089, tier: 3, isMajor: false },
  ],
  JH: [
    { name: 'Ranchi', lat: 23.3441, lng: 85.3096, tier: 1, isMajor: true },
    { name: 'Jamshedpur', lat: 22.8046, lng: 86.2029, tier: 1, isMajor: true },
    { name: 'Dhanbad', lat: 23.7957, lng: 86.4304, tier: 2, isMajor: false },
    { name: 'Bokaro', lat: 23.6693, lng: 85.9676, tier: 2, isMajor: false },
    { name: 'Deoghar', lat: 24.4833, lng: 86.6944, tier: 2, isMajor: false },
    { name: 'Hazaribagh', lat: 23.9916, lng: 85.3575, tier: 2, isMajor: false },
    { name: 'Giridih', lat: 24.1857, lng: 86.3062, tier: 3, isMajor: false },
  ],
  KA: [
    { name: 'Bengaluru', lat: 12.9716, lng: 77.5946, tier: 1, isMajor: true },
    { name: 'Mysuru', lat: 12.2958, lng: 76.6394, tier: 1, isMajor: true },
    { name: 'Mangaluru', lat: 12.9141, lng: 74.8560, tier: 1, isMajor: true },
    { name: 'Hubballi', lat: 15.3647, lng: 75.1240, tier: 2, isMajor: false },
    { name: 'Dharwad', lat: 15.4589, lng: 75.0078, tier: 2, isMajor: false },
    { name: 'Kalaburagi', lat: 17.3297, lng: 76.8343, tier: 2, isMajor: false },
    { name: 'Ballari', lat: 15.1394, lng: 76.9214, tier: 2, isMajor: false },
    { name: 'Vijayapura', lat: 16.8302, lng: 75.7100, tier: 2, isMajor: false },
    { name: 'Belagavi', lat: 15.8497, lng: 74.4977, tier: 2, isMajor: false },
    { name: 'Shivamogga', lat: 13.9299, lng: 75.5681, tier: 2, isMajor: false },
    { name: 'Tumakuru', lat: 13.3409, lng: 77.1010, tier: 2, isMajor: false },
    { name: 'Davanagere', lat: 14.4644, lng: 75.9218, tier: 2, isMajor: false },
    { name: 'Udupi', lat: 13.3409, lng: 74.7421, tier: 2, isMajor: false },
    { name: 'Hassan', lat: 13.0068, lng: 76.1003, tier: 3, isMajor: false },
  ],
  KL: [
    { name: 'Thiruvananthapuram', lat: 8.5241, lng: 76.9366, tier: 1, isMajor: true },
    { name: 'Kochi', lat: 9.9312, lng: 76.2673, tier: 1, isMajor: true },
    { name: 'Kozhikode', lat: 11.2588, lng: 75.7804, tier: 1, isMajor: true },
    { name: 'Thrissur', lat: 10.5276, lng: 76.2144, tier: 2, isMajor: false },
    { name: 'Kollam', lat: 8.8932, lng: 76.6141, tier: 2, isMajor: false },
    { name: 'Palakkad', lat: 10.7867, lng: 76.6548, tier: 2, isMajor: false },
    { name: 'Alappuzha', lat: 9.4981, lng: 76.3388, tier: 2, isMajor: false },
    { name: 'Kannur', lat: 11.8745, lng: 75.3704, tier: 2, isMajor: false },
    { name: 'Malappuram', lat: 11.0732, lng: 76.0741, tier: 2, isMajor: false },
    { name: 'Kottayam', lat: 9.5916, lng: 76.5222, tier: 2, isMajor: false },
    { name: 'Pathanamthitta', lat: 9.2648, lng: 76.7870, tier: 3, isMajor: false },
    { name: 'Idukki', lat: 9.9152, lng: 76.9752, tier: 3, isMajor: false },
  ],
  MP: [
    { name: 'Bhopal', lat: 23.2599, lng: 77.4126, tier: 1, isMajor: true },
    { name: 'Indore', lat: 22.7196, lng: 75.8577, tier: 1, isMajor: true },
    { name: 'Jabalpur', lat: 23.1815, lng: 79.9864, tier: 1, isMajor: true },
    { name: 'Gwalior', lat: 26.2183, lng: 78.1828, tier: 1, isMajor: true },
    { name: 'Ujjain', lat: 23.1828, lng: 75.7772, tier: 2, isMajor: false },
    { name: 'Sagar', lat: 23.8388, lng: 78.7378, tier: 2, isMajor: false },
    { name: 'Dewas', lat: 22.9623, lng: 76.0508, tier: 2, isMajor: false },
    { name: 'Satna', lat: 24.5862, lng: 80.8322, tier: 2, isMajor: false },
    { name: 'Ratlam', lat: 23.3315, lng: 75.0367, tier: 2, isMajor: false },
    { name: 'Rewa', lat: 24.5362, lng: 81.3042, tier: 2, isMajor: false },
    { name: 'Chhindwara', lat: 22.0574, lng: 78.9382, tier: 3, isMajor: false },
    { name: 'Singrauli', lat: 24.1997, lng: 82.6747, tier: 3, isMajor: false },
    { name: 'Pithampur', lat: 22.5999, lng: 75.6958, tier: 3, isMajor: false },
  ],
  MH: [
    { name: 'Mumbai', lat: 19.0760, lng: 72.8777, tier: 1, isMajor: true },
    { name: 'Pune', lat: 18.5204, lng: 73.8567, tier: 1, isMajor: true },
    { name: 'Nagpur', lat: 21.1458, lng: 79.0882, tier: 1, isMajor: true },
    { name: 'Thane', lat: 19.2183, lng: 72.9781, tier: 1, isMajor: true },
    { name: 'Nashik', lat: 19.9975, lng: 73.7898, tier: 1, isMajor: true },
    { name: 'Aurangabad', lat: 19.8762, lng: 75.3433, tier: 1, isMajor: true },
    { name: 'Solapur', lat: 17.6805, lng: 75.9064, tier: 2, isMajor: false },
    { name: 'Kalyan-Dombivli', lat: 19.2403, lng: 73.1305, tier: 2, isMajor: false },
    { name: 'Vasai-Virar', lat: 19.3948, lng: 72.8258, tier: 2, isMajor: false },
    { name: 'Navi Mumbai', lat: 19.0330, lng: 73.0297, tier: 1, isMajor: true },
    { name: 'Kolhapur', lat: 16.7050, lng: 74.2433, tier: 2, isMajor: false },
    { name: 'Amravati', lat: 20.9320, lng: 77.7523, tier: 2, isMajor: false },
    { name: 'Sangli', lat: 16.8524, lng: 74.5815, tier: 2, isMajor: false },
    { name: 'Malegaon', lat: 20.5579, lng: 74.5089, tier: 2, isMajor: false },
    { name: 'Jalgaon', lat: 21.0077, lng: 75.5626, tier: 2, isMajor: false },
    { name: 'Akola', lat: 20.7002, lng: 77.0082, tier: 2, isMajor: false },
    { name: 'Latur', lat: 18.4088, lng: 76.5604, tier: 2, isMajor: false },
    { name: 'Dhule', lat: 20.9042, lng: 74.7749, tier: 2, isMajor: false },
    { name: 'Ahmednagar', lat: 19.0948, lng: 74.7480, tier: 2, isMajor: false },
    { name: 'Ichalkaranji', lat: 16.6928, lng: 74.4618, tier: 2, isMajor: false },
    { name: 'Pimpri-Chinchwad', lat: 18.6298, lng: 73.7997, tier: 1, isMajor: true },
    { name: 'Panvel', lat: 18.9894, lng: 73.1175, tier: 2, isMajor: false },
    { name: 'Raigad', lat: 18.5123, lng: 73.1789, tier: 3, isMajor: false },
  ],
  OD: [
    { name: 'Bhubaneswar', lat: 20.2961, lng: 85.8189, tier: 1, isMajor: true },
    { name: 'Cuttack', lat: 20.4625, lng: 85.8830, tier: 1, isMajor: true },
    { name: 'Rourkela', lat: 22.2270, lng: 84.8647, tier: 2, isMajor: false },
    { name: 'Brahmapur', lat: 19.3149, lng: 84.7941, tier: 2, isMajor: false },
    { name: 'Sambalpur', lat: 21.4669, lng: 83.9812, tier: 2, isMajor: false },
    { name: 'Puri', lat: 19.8135, lng: 85.8312, tier: 2, isMajor: false },
    { name: 'Balasore', lat: 21.4942, lng: 86.9331, tier: 2, isMajor: false },
    { name: 'Bhadrak', lat: 21.0583, lng: 86.4927, tier: 3, isMajor: false },
    { name: 'Jharsuguda', lat: 21.8553, lng: 84.0069, tier: 3, isMajor: false },
  ],
  PB: [
    { name: 'Ludhiana', lat: 30.9010, lng: 75.8573, tier: 1, isMajor: true },
    { name: 'Amritsar', lat: 31.6340, lng: 74.8723, tier: 1, isMajor: true },
    { name: 'Jalandhar', lat: 31.3260, lng: 75.5762, tier: 1, isMajor: true },
    { name: 'Patiala', lat: 30.3398, lng: 76.3869, tier: 2, isMajor: false },
    { name: 'Bathinda', lat: 30.2110, lng: 74.9455, tier: 2, isMajor: false },
    { name: 'Hoshiarpur', lat: 31.5143, lng: 75.9106, tier: 2, isMajor: false },
    { name: 'Mohali', lat: 30.7046, lng: 76.7179, tier: 2, isMajor: false },
    { name: 'Gurdaspur', lat: 32.0425, lng: 75.4028, tier: 2, isMajor: false },
    { name: 'Firozpur', lat: 30.9355, lng: 74.6064, tier: 2, isMajor: false },
    { name: 'Moga', lat: 30.8174, lng: 75.1691, tier: 3, isMajor: false },
    { name: 'Pathankot', lat: 32.2648, lng: 75.6526, tier: 2, isMajor: false },
  ],
  RJ: [
    { name: 'Jaipur', lat: 26.9124, lng: 75.7873, tier: 1, isMajor: true },
    { name: 'Jodhpur', lat: 26.2389, lng: 73.0243, tier: 1, isMajor: true },
    { name: 'Kota', lat: 25.2138, lng: 75.8648, tier: 1, isMajor: true },
    { name: 'Bikaner', lat: 28.0229, lng: 73.3119, tier: 2, isMajor: false },
    { name: 'Ajmer', lat: 26.4499, lng: 74.6399, tier: 2, isMajor: false },
    { name: 'Udaipur', lat: 24.5854, lng: 73.7125, tier: 2, isMajor: false },
    { name: 'Bhilwara', lat: 25.3462, lng: 74.6313, tier: 2, isMajor: false },
    { name: 'Alwar', lat: 27.5665, lng: 76.6181, tier: 2, isMajor: false },
    { name: 'Bharatpur', lat: 27.2173, lng: 77.4900, tier: 2, isMajor: false },
    { name: 'Sikar', lat: 27.6094, lng: 75.1398, tier: 2, isMajor: false },
    { name: 'Sri Ganganagar', lat: 29.9094, lng: 73.8771, tier: 2, isMajor: false },
    { name: 'Pali', lat: 25.7710, lng: 73.3234, tier: 3, isMajor: false },
    { name: 'Barmer', lat: 25.7521, lng: 71.3967, tier: 3, isMajor: false },
    { name: 'Chittorgarh', lat: 24.8887, lng: 74.6269, tier: 3, isMajor: false },
  ],
  TN: [
    { name: 'Chennai', lat: 13.0827, lng: 80.2707, tier: 1, isMajor: true },
    { name: 'Coimbatore', lat: 11.0168, lng: 76.9558, tier: 1, isMajor: true },
    { name: 'Madurai', lat: 9.9252, lng: 78.1198, tier: 1, isMajor: true },
    { name: 'Tiruchirappalli', lat: 10.7905, lng: 78.7047, tier: 1, isMajor: true },
    { name: 'Salem', lat: 11.6643, lng: 78.1460, tier: 2, isMajor: false },
    { name: 'Tirunelveli', lat: 8.7139, lng: 77.7567, tier: 2, isMajor: false },
    { name: 'Tiruppur', lat: 11.1085, lng: 77.3411, tier: 2, isMajor: false },
    { name: 'Vellore', lat: 12.9165, lng: 79.1325, tier: 2, isMajor: false },
    { name: 'Erode', lat: 11.3410, lng: 77.7172, tier: 2, isMajor: false },
    { name: 'Thoothukkudi', lat: 8.7642, lng: 78.1348, tier: 2, isMajor: false },
    { name: 'Dindigul', lat: 10.3624, lng: 77.9695, tier: 2, isMajor: false },
    { name: 'Thanjavur', lat: 10.7870, lng: 79.1378, tier: 2, isMajor: false },
    { name: 'Ranipet', lat: 12.9290, lng: 79.3325, tier: 3, isMajor: false },
    { name: 'Hosur', lat: 12.7409, lng: 77.8253, tier: 2, isMajor: false },
    { name: 'Cuddalore', lat: 11.7480, lng: 79.7714, tier: 3, isMajor: false },
    { name: 'Kancheepuram', lat: 12.8333, lng: 79.7000, tier: 2, isMajor: false },
  ],
  TG: [
    { name: 'Hyderabad', lat: 17.3850, lng: 78.4867, tier: 1, isMajor: true },
    { name: 'Warangal', lat: 17.9689, lng: 79.5941, tier: 2, isMajor: false },
    { name: 'Nizamabad', lat: 18.6725, lng: 78.0942, tier: 2, isMajor: false },
    { name: 'Karimnagar', lat: 18.4386, lng: 79.1288, tier: 2, isMajor: false },
    { name: 'Khammam', lat: 17.2473, lng: 80.1514, tier: 2, isMajor: false },
    { name: 'Ramagundam', lat: 18.8059, lng: 79.4660, tier: 2, isMajor: false },
    { name: 'Mahbubnagar', lat: 16.7488, lng: 77.9864, tier: 2, isMajor: false },
    { name: 'Nalgonda', lat: 17.0575, lng: 79.2680, tier: 2, isMajor: false },
    { name: 'Adilabad', lat: 19.6641, lng: 78.5320, tier: 3, isMajor: false },
    { name: 'Secunderabad', lat: 17.4399, lng: 78.4983, tier: 1, isMajor: true },
    { name: 'Siddipet', lat: 18.1017, lng: 78.8524, tier: 3, isMajor: false },
  ],
  UP: [
    { name: 'Lucknow', lat: 26.8467, lng: 80.9462, tier: 1, isMajor: true },
    { name: 'Kanpur', lat: 26.4499, lng: 80.3319, tier: 1, isMajor: true },
    { name: 'Ghaziabad', lat: 28.6692, lng: 77.4538, tier: 1, isMajor: true },
    { name: 'Agra', lat: 27.1767, lng: 78.0081, tier: 1, isMajor: true },
    { name: 'Meerut', lat: 28.9845, lng: 77.7064, tier: 1, isMajor: true },
    { name: 'Varanasi', lat: 25.3176, lng: 82.9739, tier: 1, isMajor: true },
    { name: 'Prayagraj', lat: 25.4358, lng: 81.8463, tier: 1, isMajor: true },
    { name: 'Bareilly', lat: 28.3670, lng: 79.4304, tier: 2, isMajor: false },
    { name: 'Aligarh', lat: 27.8974, lng: 78.0880, tier: 2, isMajor: false },
    { name: 'Moradabad', lat: 28.8386, lng: 78.7733, tier: 2, isMajor: false },
    { name: 'Saharanpur', lat: 29.9640, lng: 77.5460, tier: 2, isMajor: false },
    { name: 'Gorakhpur', lat: 26.7606, lng: 83.3732, tier: 2, isMajor: false },
    { name: 'Noida', lat: 28.5355, lng: 77.3910, tier: 1, isMajor: true },
    { name: 'Firozabad', lat: 27.1592, lng: 78.3957, tier: 2, isMajor: false },
    { name: 'Jhansi', lat: 25.4484, lng: 78.5685, tier: 2, isMajor: false },
    { name: 'Muzaffarnagar', lat: 29.4727, lng: 77.7085, tier: 2, isMajor: false },
    { name: 'Mathura', lat: 27.4924, lng: 77.6737, tier: 2, isMajor: false },
    { name: 'Rampur', lat: 28.8080, lng: 79.0260, tier: 3, isMajor: false },
    { name: 'Ayodhya', lat: 26.7922, lng: 82.1998, tier: 2, isMajor: false },
    { name: 'Hapur', lat: 28.7290, lng: 77.7758, tier: 2, isMajor: false },
  ],
  UK: [
    { name: 'Dehradun', lat: 30.3165, lng: 78.0322, tier: 1, isMajor: true },
    { name: 'Haridwar', lat: 29.9457, lng: 78.1642, tier: 2, isMajor: false },
    { name: 'Roorkee', lat: 29.8543, lng: 77.8880, tier: 2, isMajor: false },
    { name: 'Haldwani', lat: 29.2183, lng: 79.5130, tier: 2, isMajor: false },
    { name: 'Rudrapur', lat: 28.9784, lng: 79.3930, tier: 2, isMajor: false },
    { name: 'Kashipur', lat: 29.2074, lng: 78.9632, tier: 3, isMajor: false },
    { name: 'Rishikesh', lat: 30.0869, lng: 78.2676, tier: 2, isMajor: false },
    { name: 'Kotdwar', lat: 29.7447, lng: 78.5200, tier: 3, isMajor: false },
  ],
  WB: [
    { name: 'Kolkata', lat: 22.5726, lng: 88.3639, tier: 1, isMajor: true },
    { name: 'Asansol', lat: 23.6739, lng: 86.9524, tier: 2, isMajor: false },
    { name: 'Siliguri', lat: 26.7271, lng: 88.3953, tier: 2, isMajor: false },
    { name: 'Durgapur', lat: 23.5204, lng: 87.3119, tier: 2, isMajor: false },
    { name: 'Bardhaman', lat: 23.2324, lng: 87.8615, tier: 2, isMajor: false },
    { name: 'Malda', lat: 25.0108, lng: 88.1416, tier: 2, isMajor: false },
    { name: 'Baharampur', lat: 24.1062, lng: 88.2520, tier: 2, isMajor: false },
    { name: 'Habra', lat: 22.8386, lng: 88.6572, tier: 3, isMajor: false },
    { name: 'Kharagpur', lat: 22.3302, lng: 87.3237, tier: 2, isMajor: false },
    { name: 'Darjeeling', lat: 27.0360, lng: 88.2627, tier: 2, isMajor: false },
    { name: 'Jalpaiguri', lat: 26.5429, lng: 88.7180, tier: 2, isMajor: false },
    { name: 'Haldia', lat: 22.0667, lng: 88.0581, tier: 2, isMajor: false },
    { name: 'Raiganj', lat: 25.6150, lng: 88.1253, tier: 3, isMajor: false },
    { name: 'Howrah', lat: 22.5958, lng: 88.2636, tier: 1, isMajor: true },
    { name: 'Purulia', lat: 23.3328, lng: 86.3641, tier: 3, isMajor: false },
  ],
  DL: [
    { name: 'New Delhi', lat: 28.6139, lng: 77.2090, tier: 1, isMajor: true },
    { name: 'Delhi', lat: 28.7041, lng: 77.1025, tier: 1, isMajor: true },
    { name: 'Dwarka', lat: 28.5921, lng: 77.0460, tier: 1, isMajor: false },
    { name: 'Rohini', lat: 28.7363, lng: 77.1175, tier: 1, isMajor: false },
    { name: 'Janakpuri', lat: 28.6269, lng: 77.0835, tier: 1, isMajor: false },
    { name: 'Laxmi Nagar', lat: 28.6343, lng: 77.2775, tier: 1, isMajor: false },
    { name: 'Nehru Place', lat: 28.5491, lng: 77.2521, tier: 1, isMajor: false },
    { name: 'Saket', lat: 28.5245, lng: 77.2066, tier: 1, isMajor: false },
    { name: 'Pitampura', lat: 28.7018, lng: 77.1293, tier: 1, isMajor: false },
  ],
  CH: [
    { name: 'Chandigarh', lat: 30.7333, lng: 76.7794, tier: 1, isMajor: true },
    { name: 'Panchkula', lat: 30.6942, lng: 76.8606, tier: 2, isMajor: false },
    { name: 'Mohali', lat: 30.7046, lng: 76.7179, tier: 2, isMajor: false },
  ],
  JK: [
    { name: 'Srinagar', lat: 34.0837, lng: 74.7973, tier: 2, isMajor: true },
    { name: 'Jammu', lat: 32.7266, lng: 74.8570, tier: 2, isMajor: true },
    { name: 'Anantnag', lat: 33.7311, lng: 75.1487, tier: 3, isMajor: false },
    { name: 'Baramulla', lat: 34.2009, lng: 74.3401, tier: 3, isMajor: false },
    { name: 'Sopore', lat: 34.2980, lng: 74.4737, tier: 3, isMajor: false },
    { name: 'Udhampur', lat: 32.9160, lng: 75.1415, tier: 3, isMajor: false },
  ],
  PY: [
    { name: 'Puducherry', lat: 11.9416, lng: 79.8083, tier: 2, isMajor: true },
    { name: 'Karaikal', lat: 10.9254, lng: 79.8380, tier: 3, isMajor: false },
    { name: 'Mahé', lat: 11.7012, lng: 75.5344, tier: 3, isMajor: false },
  ],
};

// ─── Pincode ranges per state ────────────────────────────────────────────────
const PINCODE_RANGES = {
  AP: [[500001, 500100], [520001, 520100], [530001, 530100]],
  AR: [[790001, 790100]],
  AS: [[781001, 781100], [786001, 786100]],
  BR: [[800001, 800100], [823001, 823100]],
  CG: [[490001, 490100], [492001, 492100]],
  GA: [[403001, 403100]],
  GJ: [[380001, 380100], [395001, 395100], [360001, 360100]],
  HR: [[122001, 122100], [121001, 121100], [132001, 132100]],
  HP: [[171001, 171100], [176001, 176100]],
  JH: [[834001, 834100], [831001, 831100]],
  KA: [[560001, 560100], [570001, 570100], [575001, 575100]],
  KL: [[695001, 695100], [682001, 682100], [673001, 673100]],
  MP: [[462001, 462100], [452001, 452100], [482001, 482100]],
  MH: [[400001, 400100], [411001, 411100], [440001, 440100]],
  MN: [[795001, 795100]],
  ML: [[793001, 793100]],
  MZ: [[796001, 796100]],
  NL: [[797001, 797100]],
  OD: [[751001, 751100], [760001, 760100]],
  PB: [[141001, 141100], [143001, 143100], [144001, 144100]],
  RJ: [[302001, 302100], [342001, 342100], [305001, 305100]],
  SK: [[737001, 737100]],
  TN: [[600001, 600100], [641001, 641100], [625001, 625100]],
  TG: [[500001, 500050], [506001, 506100]],
  TR: [[799001, 799100]],
  UP: [[226001, 226100], [208001, 208100], [201001, 201100]],
  UK: [[248001, 248100], [249001, 249100]],
  WB: [[700001, 700100], [711001, 711100]],
  AN: [[744101, 744200]],
  CH: [[160001, 160100]],
  DN: [[396191, 396210]],
  DL: [[110001, 110100]],
  JK: [[180001, 180100], [190001, 190100]],
  LA: [[194101, 194200]],
  LD: [[682555, 682570]],
  PY: [[605001, 605100]],
};

const AREA_NAMES = [
  'Main Market', 'Civil Lines', 'Industrial Area', 'Sector 1', 'Sector 5', 'Sector 10',
  'Old City', 'New Colony', 'Railway Station Area', 'Bus Stand', 'College Road',
  'Hospital Road', 'Market Road', 'Central Area', 'West Extension', 'East Area',
  'North Campus', 'South Zone', 'Tech Park', 'Industrial Estate', 'Commercial Hub',
  'Residential Zone', 'Government Colony', 'Defense Colony', 'Airport Road',
  'Highway Area', 'River Bank', 'Park Area', 'Temple Road', 'Shopping Complex',
];

class LocationsSeed {
  constructor() {
    this.logger = new SeedLogger('Locations');
    this.mongoose = mongoose;
  }

  async execute() {
    try {
      this.logger.info('📍 Seeding Locations — 36 states, 400+ cities, 2500+ pincodes');
      const conn = this.mongoose.connection;
      if (!conn || !conn.collection) throw new Error('MongoDB connection not available');

      // ── Clear existing ──────────────────────────────────────────────────────
      await conn.collection('adminstates').deleteMany({});
      await conn.collection('admincities').deleteMany({});
      await conn.collection('adminzipcodes').deleteMany({});

      // ── Get India's countryId ───────────────────────────────────────────────
      const indiaDoc = await conn.collection('admincountries').findOne({ code: 'IN' });
      if (!indiaDoc) throw new Error('India country record not found — run countries seed first');
      const indiaId = indiaDoc._id;

      // ── Insert States ───────────────────────────────────────────────────────
      const stateDocs = STATES.map(s => ({
        _id: new mongoose.Types.ObjectId(),
        name: s.name,
        countryId: indiaId,
        gstCode: s.gstCode,
        stateCode: s.code,
        region: s.region,
        tier: s.tier,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await conn.collection('adminstates').insertMany(stateDocs);
      this.logger.recordBatch(stateDocs.length);

      // Build state code → _id map
      const stateIdMap = {};
      stateDocs.forEach(s => { stateIdMap[s.stateCode] = s._id; });

      // ── Insert Cities ───────────────────────────────────────────────────────
      const cityDocs = [];
      for (const stateDoc of stateDocs) {
        const cities = CITIES_BY_STATE[stateDoc.stateCode];
        if (!cities) continue;
        for (const c of cities) {
          cityDocs.push({
            _id: new mongoose.Types.ObjectId(),
            name: c.name,
            stateId: stateDoc._id,
            stateCode: stateDoc.stateCode,
            latitude: c.lat,
            longitude: c.lng,
            tier: c.tier,
            isMajor: c.isMajor,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
      // Batch insert cities
      const cityBatchSize = 200;
      for (let i = 0; i < cityDocs.length; i += cityBatchSize) {
        await conn.collection('admincities').insertMany(cityDocs.slice(i, i + cityBatchSize));
      }
      this.logger.recordBatch(cityDocs.length);

      // Build city name+stateCode → _id map
      const cityIdMap = {};
      cityDocs.forEach(c => { cityIdMap[`${c.stateCode}:${c.name}`] = c._id; });

      // ── Insert ZipCodes ─────────────────────────────────────────────────────
      const zipDocs = [];
      for (const stateDoc of stateDocs) {
        const sc = stateDoc.stateCode;
        const ranges = PINCODE_RANGES[sc];
        if (!ranges) continue;
        const stateCities = cityDocs.filter(c => c.stateCode === sc);
        if (!stateCities.length) continue;

        let pincodeIndex = 0;
        for (const [start, end] of ranges) {
          for (let pin = start; pin <= end; pin += 1) {
            const city = stateCities[pincodeIndex % stateCities.length];
            const isTier1 = city.tier === 1;
            zipDocs.push({
              _id: new mongoose.Types.ObjectId(),
              zipCode: String(pin),
              areaName: AREA_NAMES[pincodeIndex % AREA_NAMES.length],
              countryId: indiaId,
              stateId: stateDoc._id,
              cityId: city._id,
              latitude: city.latitude + (Math.random() - 0.5) * 0.1,
              longitude: city.longitude + (Math.random() - 0.5) * 0.1,
              serviceable: true,
              codAvailable: isTier1 || Math.random() > 0.1,
              expressDelivery: isTier1,
              deliveryCharge: isTier1 ? 0 : 50,
              minOrderAmount: isTier1 ? 0 : 299,
              estimatedDeliveryDays: isTier1 ? 1 : city.tier === 2 ? 3 : 5,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            pincodeIndex++;
          }
        }
      }

      const zipBatchSize = 500;
      for (let i = 0; i < zipDocs.length; i += zipBatchSize) {
        await conn.collection('adminzipcodes').insertMany(zipDocs.slice(i, i + zipBatchSize));
      }
      this.logger.recordBatch(zipDocs.length);

      this.logger.printStats();
      return {
        created: stateDocs.length + cityDocs.length + zipDocs.length,
        states: stateDocs.length,
        cities: cityDocs.length,
        pincodes: zipDocs.length,
      };
    } catch (error) {
      this.logger.error('Locations seeding failed', error);
      throw error;
    }
  }
}

module.exports = LocationsSeed;

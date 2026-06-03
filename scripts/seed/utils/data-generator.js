/**
 * Realistic Data Generator for Ecommerce Seed
 * Generates realistic data matching production systems
 */

const { faker } = require('@faker-js/faker');
const slugify = require('slugify');
const { v4: uuidv4 } = require('uuid');

class DataGenerator {
  static generateUUID() {
    return uuidv4();
  }

  static generateSlug(text) {
    return slugify(text, { lower: true, strict: true });
  }

  static generateSKU(prefix = 'SKU', length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = prefix + '-';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static generateBarcode() {
    return Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('');
  }

  static generateGSTIN() {
    // Indian GSTIN: 2-digit state + 10-digit PAN + 1-digit entity + 1-digit check
    const stateCode = String(Math.floor(Math.random() * 37)).padStart(2, '0');
    const pan = 'AAAA0' + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const entity = Math.floor(Math.random() * 10);
    const check = Math.floor(Math.random() * 10);
    return stateCode + pan + entity + check;
  }

  static generatePAN() {
    // PAN format: AAAAA0000A (5 letters + 4 digits + 1 letter)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let pan = '';
    for (let i = 0; i < 5; i++) {
      pan += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    pan += String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    pan += letters.charAt(Math.floor(Math.random() * letters.length));
    return pan;
  }

  static generateBusinessName() {
    const prefixes = [
      'Tech', 'Digital', 'Smart', 'Eco', 'Prime', 'Ultra', 'Global', 'Mega',
      'Professional', 'Quality', 'Premium', 'Elite', 'Advanced', 'Modern',
    ];
    const suffixes = [
      'Solutions', 'Enterprises', 'Corp', 'Industries', 'Trading', 'Services',
      'Commerce', 'Retail', 'Distribution', 'Holdings', 'Group', 'Ventures',
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${prefix} ${suffix}`;
  }

  static generateProductTitle(category = '', brand = '') {
    const adjectives = ['Premium', 'Professional', 'Ultra', 'Elite', 'Advanced', 'Deluxe'];
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    return `${adjective} ${brand ? brand + ' ' : ''}${category}`;
  }

  static generateDescription(type = 'short') {
    const shortDesc = [
      'High-quality product designed for everyday use',
      'Best-in-class performance and durability',
      'Perfect for professional and personal use',
      'Engineered for excellence and reliability',
      'Trusted by thousands of satisfied customers',
    ];

    const longDesc = [
      'This premium product combines superior quality, elegant design, and outstanding performance. Manufactured using the finest materials and cutting-edge technology, it ensures durability and reliability. Perfect for both professional and personal use, offering exceptional value for money.',
      'Experience excellence with this meticulously crafted product. Featuring advanced technology and premium materials, it delivers superior performance in every use. Ideal for discerning customers who value quality, reliability, and style.',
      'Engineered to perfection, this product stands out for its exceptional quality and outstanding performance. Featuring innovative design, premium materials, and rigorous quality control, it exceeds industry standards.',
    ];

    if (type === 'short') {
      return shortDesc[Math.floor(Math.random() * shortDesc.length)];
    }
    return longDesc[Math.floor(Math.random() * longDesc.length)];
  }

  static generatePrice(min = 100, max = 50000) {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
  }

  static calculateSalePrice(mrp, discountPercent = null) {
    const discount = discountPercent || Math.floor(Math.random() * 40) + 5;
    return Math.round(mrp * (1 - discount / 100) * 100) / 100;
  }

  static generateDimensions() {
    return {
      length: Math.round(Math.random() * 100) + 5,
      width: Math.round(Math.random() * 100) + 5,
      height: Math.round(Math.random() * 100) + 5,
      unit: 'cm',
    };
  }

  static generateWeight() {
    return {
      value: Math.round(Math.random() * 10000) / 100,
      unit: 'kg',
    };
  }

  static generatePhoneNumber(country = 'IN') {
    if (country === 'IN') {
      return '+91' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
    }
    return faker.phone.number();
  }

  static generateIndianPincode() {
    return Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
  }

  static generateBankAccount() {
    return {
      accountNumber: Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join(''),
      ifscCode: 'IFSC' + Array.from({ length: 7 }, () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]
      ).join(''),
      accountHolderName: faker.person.fullName(),
      bankName: faker.company.name() + ' Bank',
      branchName: faker.address.city() + ' Branch',
    };
  }

  static generateImageUrl(category = '', variant = '') {
    // Map categories to realistic image providers
    const imageProviders = {
      electronics: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e',
      fashion: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab',
      furniture: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc',
      beauty: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883',
      food: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd',
      toys: 'https://images.unsplash.com/photo-1633210003293-e4d3c376c069',
      automotive: 'https://images.unsplash.com/photo-1552519507-da3effff00bc',
    };

    const baseUrl = imageProviders[category?.toLowerCase()] || 'https://images.unsplash.com/photo-1572635196237-14b3f281503f';
    const size = '?w=800&h=800&fit=crop';
    const index = Math.floor(Math.random() * 5);
    return `${baseUrl}-${index}${size}`;
  }

  static generateColorVariant() {
    const colors = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Navy', 'Grey', 'Brown', 'Pink', 'Purple', 'Orange'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  static generateSizeVariant(type = 'clothing') {
    const sizes = {
      clothing: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      shoes: ['5', '6', '7', '8', '9', '10', '11', '12', '13'],
      storage: ['64GB', '128GB', '256GB', '512GB', '1TB'],
      ram: ['4GB', '6GB', '8GB', '12GB', '16GB', '32GB'],
    };
    const sizeList = sizes[type] || sizes.clothing;
    return sizeList[Math.floor(Math.random() * sizeList.length)];
  }

  static generateAddress(city = '', state = '') {
    return {
      line1: faker.location.streetAddress(),
      line2: faker.location.secondaryAddress(),
      city: city || faker.location.city(),
      state: state || faker.location.state(),
      country: 'India',
      postalCode: this.generateIndianPincode(),
    };
  }

  static generateSEOData(title = '', category = '') {
    return {
      metaTitle: title || `${category} - Best Online Shopping`,
      metaDescription: `Explore premium ${category}. Shop from trusted sellers with fast delivery and secure payments.`,
      keywords: [category, 'online shopping', 'buy online', 'best deals', 'authentic products'],
      canonicalUrl: null,
      ogImage: this.generateImageUrl(category),
    };
  }

  static generateReviewContent() {
    const pros = ['Great quality', 'Fast delivery', 'Good price', 'Excellent product', 'Highly recommended'];
    const cons = ['Slightly expensive', 'Could be better', 'Average quality', 'Good but not great'];
    return {
      title: pros[Math.floor(Math.random() * pros.length)],
      text: faker.lorem.sentences(3),
      pros: [pros[Math.floor(Math.random() * pros.length)], pros[Math.floor(Math.random() * pros.length)]],
      cons: [cons[Math.floor(Math.random() * cons.length)]],
    };
  }

  static generateBatch(generator, count) {
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(generator());
    }
    return results;
  }

  static randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static randomArray(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  static randomArrayItems(array, count) {
    const shuffled = [...array].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, array.length));
  }
}

module.exports = DataGenerator;

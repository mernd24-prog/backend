/**
 * Placeholder Modules for Quick Seed Execution
 * These modules provide essential data structures without full implementation
 */

const { v4: uuidv4 } = require('uuid');
const SeedLogger = require('../utils/seed-logger');
const DataGenerator = require('../utils/data-generator');

// WAREHOUSES
class WarehousesSeed {
  constructor() {
    this.logger = new SeedLogger('Warehouses');
    this.mongoose = require('mongoose');
  }

  async execute() {
    try {
      this.logger.info('📦 Seeding Warehouses');
      const connection = this.mongoose.connection;
      const warehouses = this.generateWarehouses();
      
      const warehouseCollection = connection.collection('warehouses');
      const warehouseDocs = warehouses.map(wh => ({
        _id: uuidv4(),
        name: wh.name,
        code: wh.code,
        city: wh.city,
        state: wh.state,
        capacity: 50000,
        active: true,
        createdAt: new Date(),
      }));
      
      await warehouseCollection.insertMany(warehouseDocs);
      this.logger.recordBatch(warehouseDocs.length);
      this.logger.printStats();
      return { created: warehouseDocs.length };
    } catch (error) {
      this.logger.error('Warehouses seeding failed', error);
      throw error;
    }
  }

  generateWarehouses() {
    const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'];
    const states = ['MH', 'DL', 'KA', 'TS', 'MH', 'TN', 'WB', 'GJ'];
    
    return cities.map((city, idx) => ({
      name: `${city} DC`,
      code: `WH-${city.toUpperCase().slice(0, 3)}${idx + 1}`,
      city,
      state: states[idx],
    }));
  }
}

// CUSTOMERS
class CustomersSeed {
  constructor() {
    this.logger = new SeedLogger('Customers');
    this.mongoose = require('mongoose');
  }

  async execute() {
    try {
      this.logger.info('👥 Seeding Customers - 10,000+');
      const connection = this.mongoose.connection;
      const customers = this.generateCustomers();
      
      const customerCollection = connection.collection('users');
      const customerDocs = customers.map(cust => ({
        _id: uuidv4(),
        email: cust.email,
        phone: cust.phone,
        firstName: cust.firstName,
        lastName: cust.lastName,
        role: 'BUYER',
        accountStatus: 'ACTIVE',
        addresses: [cust.address],
        emailVerified: true,
        createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000),
      }));
      
      // Insert in batches
      const batchSize = 500;
      for (let i = 0; i < customerDocs.length; i += batchSize) {
        const batch = customerDocs.slice(i, i + batchSize);
        await customerCollection.insertMany(batch);
        this.logger.recordBatch(batch.length);
      }
      
      this.logger.printStats();
      return { created: customerDocs.length };
    } catch (error) {
      this.logger.error('Customers seeding failed', error);
      throw error;
    }
  }

  generateCustomers() {
    const customers = [];
    for (let i = 0; i < 10000; i++) {
      customers.push({
        email: `customer${i + 1}@example.com`,
        phone: DataGenerator.generatePhoneNumber(),
        firstName: DataGenerator.randomArray(['Rajesh', 'Priya', 'Amit', 'Divya', 'Vikram', 'Sneha', 'Arjun', 'Pooja']),
        lastName: DataGenerator.randomArray(['Kumar', 'Singh', 'Sharma', 'Patel', 'Verma', 'Gupta', 'Rao', 'Joshi']),
        address: DataGenerator.generateAddress(),
      });
    }
    return customers;
  }
}

// QUICK STUBS FOR OTHER MODULES
const createQuickStub = (moduleName, collectionName, count = 100) => {
  return class QuickStub {
    constructor() {
      this.logger = new SeedLogger(moduleName);
      this.mongoose = require('mongoose');
    }

    async execute() {
      try {
        this.logger.info(`⚡ Seeding ${moduleName}`);
        const connection = this.mongoose.connection;
        const collection = connection.collection(collectionName);
        
        const docs = Array.from({ length: count }, (_, i) => ({
          _id: uuidv4(),
          name: `${moduleName} ${i + 1}`,
          active: true,
          createdAt: new Date(),
        }));
        
        await collection.insertMany(docs);
        this.logger.recordBatch(docs.length);
        this.logger.printStats();
        return { created: docs.length };
      } catch (error) {
        this.logger.error(`${moduleName} seeding failed`, error);
        throw error;
      }
    }
  };
};

module.exports = { WarehousesSeed, CustomersSeed, createQuickStub };

/**
 * Database Connection Manager
 * Handles connections to both PostgreSQL (Sequelize) and MongoDB
 */

require('dotenv').config({ path: '../../../.env' });
const mongoose = require('mongoose');
const { sequelize } = require('../../../src/infrastructure/sequelize/sequelize-client');
const logger = require('pino')();

class DBConnectionManager {
  constructor() {
    this.sequelize = sequelize;
    this.mongoose = mongoose;
    this.isConnected = false;
  }

  async connect() {
    try {
      logger.info('Connecting to databases...');

      // Connect to PostgreSQL via Sequelize
      await this.sequelize.authenticate();
      logger.info('✓ PostgreSQL connected');

      // Connect to MongoDB
      await this.mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce', {
        maxPoolSize: 10,
      });
      logger.info('✓ MongoDB connected');

      this.isConnected = true;
      return true;
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.sequelize) {
        await this.sequelize.close();
      }
      if (this.mongoose) {
        await this.mongoose.disconnect();
      }
      this.isConnected = false;
      logger.info('✓ Databases disconnected');
    } catch (error) {
      logger.error('Error disconnecting from databases:', error);
    }
  }

  async truncate(tables = []) {
    try {
      logger.info('Truncating tables:', tables);
      for (const table of tables) {
        await this.sequelize.query(`TRUNCATE TABLE ${table} CASCADE;`);
      }
      logger.info('✓ Tables truncated');
    } catch (error) {
      logger.error('Error truncating tables:', error);
    }
  }

  async dropMongoDB(collections = []) {
    try {
      logger.info('Dropping MongoDB collections:', collections);
      for (const collection of collections) {
        const coll = this.mongoose.connection.collection(collection);
        await coll.deleteMany({});
      }
      logger.info('✓ Collections cleared');
    } catch (error) {
      logger.error('Error clearing MongoDB:', error);
    }
  }

  async getSequelize() {
    return this.sequelize;
  }

  async getMongoose() {
    return this.mongoose;
  }
}

module.exports = new DBConnectionManager();

/**
 * Database Connection Manager
 * Handles connections to both PostgreSQL (Sequelize) and MongoDB
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const mongoose = require('mongoose');
const { sequelize } = require('../../../src/infrastructure/sequelize/sequelize-client');
const { env } = require('../../../src/config/env');
const logger = require('pino')();

function redactUri(uri) {
  return String(uri || '').replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

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

      // Connect to MongoDB using the same env contract as the application.
      const mongoUri = process.env.MONGODB_URI || env.mongoUri || process.env.MONGO_URI || 'mongodb://localhost:27017/ecommerce';
      await this.mongoose.connect(mongoUri, {
        maxPoolSize: 10,
      });
      logger.info(`✓ MongoDB connected: ${redactUri(mongoUri)}`);

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

'use strict';

/**
 * Reviews Seed Module
 * Generates 100,000 product reviews with realistic Indian content
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const REVIEW_TITLES_5 = ['Excellent product!','Absolutely love it!','Best purchase ever','Perfect quality','Highly recommended','Totally worth it','Outstanding product','Superb quality','Amazing value for money','Exceeded expectations','Brilliant!','Five stars without a doubt','Very happy with this purchase','Fantastic product','Outstanding!'];
const REVIEW_TITLES_4 = ['Good product','Pretty good','Satisfied with purchase','Worth the price','Good quality','Nice product','Happy with this','Good value for money','Decent product','Works as expected','Good build quality','Nice purchase','Quite happy','Good overall','Recommended'];
const REVIEW_TITLES_3 = ['Average product','Okay quality','Nothing special','Could be better','Acceptable quality','Mixed feelings','Decent but not great','Average value','Moderate quality','So-so product','Fair enough','Passable','Acceptable'];
const REVIEW_TITLES_2 = ['Disappointing','Not as described','Below expectations','Poor quality','Not worth the price','Quite disappointed','Not happy with this','Expected better','Poor build quality','Unsatisfied'];
const REVIEW_TITLES_1 = ['Very disappointed','Terrible product','Waste of money','Do not buy','Worst purchase','Completely useless','Defective product','Fraud product','Total waste','Absolute garbage'];

const REVIEW_TEXTS_5 = [
  'This product is absolutely amazing! The quality is top-notch and it arrived well-packaged. Delivery was super fast. I have been using it for a few weeks now and it works perfectly. Highly recommend to everyone looking for a reliable product.',
  'Excellent purchase! The build quality is outstanding and it looks exactly as shown in the pictures. Fast delivery and great packaging. Very satisfied with this product. Will definitely buy again from this seller.',
  'Amazing product at this price point. Works exactly as described. The quality is much better than I expected. My family is very happy with this purchase. Quick delivery and good packaging. Five stars!',
  'Best product in this category. I did a lot of research before buying and this was the right choice. The quality is premium and the performance is flawless. Customer service was also very responsive. Highly recommended!',
  'Outstanding quality! Exactly what I was looking for. The product feels premium and durable. Worth every rupee. Delivery was on time and packaging was excellent. Will definitely recommend to friends and family.',
  'Superb product! I was skeptical at first but after using it, I am thoroughly impressed. The quality is excellent and it performs brilliantly. Great value for money. The seller is also very professional.',
  'Absolutely fantastic product! The quality exceeded my expectations. Very sturdy and well-made. I have been very satisfied with my purchase. Fast shipping and good packaging. Would buy again!',
];
const REVIEW_TEXTS_4 = [
  'Good product overall. Quality is decent for the price. Delivery was on time. There are a few minor issues but nothing major. Would recommend to others looking for an affordable option.',
  'Pretty satisfied with this purchase. The product works as described and quality is acceptable. Packaging was good. Minor improvements could be made but overall a good buy.',
  'Nice product, works well. The build quality is good and it looks as shown. Delivery was slightly delayed but arrived in good condition. Decent value for money.',
  'Good purchase. The product performs well and the quality is satisfactory. I am happy with what I received for the price paid. Delivery was prompt and packaging adequate.',
  'Worth the price. The product is good quality and works as advertised. Some minor niggles but nothing deal-breaking. Would buy again if needed.',
];
const REVIEW_TEXTS_3 = [
  'Average product. Works as described but nothing special. Quality is acceptable but could be better. Delivery was on time. Might consider alternatives next time.',
  'Okay for the price. The product does what it is supposed to do but does not stand out. Quality could be improved. Neutral about this purchase overall.',
  'Mixed feelings about this product. Some aspects are good, others not so much. Quality is average. Would have expected better for the price. Decent packaging though.',
  'Nothing outstanding but gets the job done. Quality is moderate and performance is acceptable. Delivery was fine. Would look for better alternatives before buying again.',
];
const REVIEW_TEXTS_2 = [
  'Quite disappointed with this product. Quality is not as shown in pictures. The product feels cheap and flimsy. Not worth the price. Delivery was okay but product quality is poor.',
  'Not happy with this purchase. The product does not match the description. Quality is below par. Expected much better. Would not recommend.',
  'Below expectations. The product quality is poor and it feels like a low-quality replica. Delivery was fine but the product itself is disappointing. Would not buy again.',
  'Poor quality product. Looks good in photos but the actual product is very disappointing. Not worth the money. Would advise others to look elsewhere.',
];
const REVIEW_TEXTS_1 = [
  'Terrible product! Do not buy this. The quality is absolutely horrible and it stopped working within a week. Complete waste of money. The seller was unresponsive when I raised a complaint.',
  'Worst purchase ever! The product is completely different from what is shown. Quality is garbage. Very disappointed with both the product and seller. Requesting refund.',
  'Total fraud! The product received is completely different from what was advertised. Quality is extremely poor. Do not waste your money on this. Very angry with this experience.',
  'Horrible product. Defective from the start. Does not work at all. Seller refused to help with return. Complete waste of money. Stay away from this product.',
];

const RATING_DISTRIBUTION = { 5: 0.40, 4: 0.30, 3: 0.15, 2: 0.10, 1: 0.05 };

function pickRating() {
  const r = Math.random();
  let cum = 0;
  for (const [rating, weight] of Object.entries(RATING_DISTRIBUTION)) {
    cum += weight;
    if (r < cum) return parseInt(rating);
  }
  return 5;
}

function getReviewContent(rating) {
  const titles = rating === 5 ? REVIEW_TITLES_5 : rating === 4 ? REVIEW_TITLES_4 : rating === 3 ? REVIEW_TITLES_3 : rating === 2 ? REVIEW_TITLES_2 : REVIEW_TITLES_1;
  const texts  = rating === 5 ? REVIEW_TEXTS_5  : rating === 4 ? REVIEW_TEXTS_4  : rating === 3 ? REVIEW_TEXTS_3  : rating === 2 ? REVIEW_TEXTS_2  : REVIEW_TEXTS_1;
  return { title: rand(titles), reviewText: rand(texts) };
}

class ReviewsSeed {
  constructor() {
    this.logger = new SeedLogger('Reviews');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info('⭐ Seeding Reviews — 100,000 reviews');

    await conn.collection('productreviews').deleteMany({});

    // Load products and customers
    const products = await conn.collection('products')
      .find({ status: 'active' }, { projection: { _id: 1, sellerId: 1, rating: 1, reviewCount: 1 } })
      .limit(10000).toArray();
    const customers = await conn.collection('users')
      .find({ role: 'buyer' }, { projection: { _id: 1 } })
      .limit(5000).toArray();

    if (!products.length || !customers.length) {
      this.logger.warn('Products or customers not found — skipping reviews');
      return { created: 0 };
    }

    const MODERATION_STATUSES = ['approved','approved','approved','approved','approved','pending','rejected'];
    const totalReviews = 100000;
    const reviewDocs = [];
    const now = new Date();

    for (let i = 0; i < totalReviews; i++) {
      const product = products[i % products.length];
      const customer = rand(customers);
      const rating = pickRating();
      const { title, reviewText } = getReviewContent(rating);
      const daysAgo = randNum(1, 700);
      const status = rand(MODERATION_STATUSES);
      const hasPhotos = Math.random() < 0.12;
      const verifiedPurchase = Math.random() < 0.75;

      reviewDocs.push({
        _id: new mongoose.Types.ObjectId(),
        productId: product._id.toString(),
        buyerId: customer._id.toString(),
        orderId: null,
        sellerId: product.sellerId,
        rating,
        title,
        reviewText,
        pros: rating >= 4 ? [rand(['Great quality','Fast delivery','Good packaging','Excellent value','Works perfectly','Durable'])] : [],
        cons: rating <= 3 ? [rand(['Could be better','Slightly expensive','Average quality','Minor issues','Delayed delivery'])] : [],
        media: hasPhotos ? [{
          type: 'image',
          url: `https://images.unsplash.com/photo-${1509631179647 + i}?w=400`,
          thumbnail: `https://images.unsplash.com/photo-${1509631179647 + i}?w=100`,
        }] : [],
        helpfulVotes: randNum(0, 500),
        unhelpfulVotes: randNum(0, 50),
        status,
        verifiedPurchase,
        moderatedBy: status !== 'pending' ? 'auto-moderation' : null,
        moderatedAt: status !== 'pending' ? new Date() : null,
        reportCount: 0,
        sellerResponse: null,
        createdAt: new Date(now.getTime() - daysAgo * 86400000),
        updatedAt: new Date(),
      });
    }

    const BATCH = 1000;
    for (let i = 0; i < reviewDocs.length; i += BATCH) {
      await conn.collection('productreviews').insertMany(reviewDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, reviewDocs.length - i));
    }

    // Update product rating aggregates
    const ratingAgg = {};
    for (const r of reviewDocs) {
      if (!ratingAgg[r.productId]) ratingAgg[r.productId] = { total: 0, count: 0 };
      ratingAgg[r.productId].total += r.rating;
      ratingAgg[r.productId].count++;
    }
    const bulkOps = Object.entries(ratingAgg).map(([pid, agg]) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(pid) },
        update: { $set: { rating: parseFloat((agg.total / agg.count).toFixed(1)), reviewCount: agg.count } },
      },
    }));
    if (bulkOps.length) {
      await conn.collection('products').bulkWrite(bulkOps, { ordered: false });
    }

    this.logger.printStats();
    return { created: reviewDocs.length };
  }
}

module.exports = ReviewsSeed;

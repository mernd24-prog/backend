'use strict';

/**
 * Products Seed Module
 * ~200 real product templates across all 27 root categories
 * Each template: [title, subcategoryKey, rootKey, brand, hsnCode, gstRate, [minMRP,maxMRP], imgKey, hasVariants, weightKg]
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const rand    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randPrice = (min, max) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

// ─── Image pools per category type ───────────────────────────────────────────
// All from Unsplash — specific product-relevant photos
const IMG = {
  smartphone: [
    'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=800',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800',
    'https://images.unsplash.com/photo-1574944985070-8f3ebc6b79d2?w=800',
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=800',
    'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=800',
  ],
  laptop: [
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800',
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800',
    'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=800',
    'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=800',
  ],
  tv: [
    'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=800',
    'https://images.unsplash.com/photo-1567690187548-f07b1d7bf5a9?w=800',
    'https://images.unsplash.com/photo-1461151304267-38535e780c79?w=800',
  ],
  earphones: [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800',
    'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=800',
    'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800',
  ],
  smartwatch: [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
    'https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?w=800',
    'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=800',
  ],
  camera: [
    'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=800',
    'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800',
    'https://images.unsplash.com/photo-1520390138845-fd2d229dd553?w=800',
  ],
  tablet: [
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800',
    'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800',
  ],
  mens_tshirt: [
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800',
    'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800',
    'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=800',
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800',
  ],
  mens_shirt: [
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800',
    'https://images.unsplash.com/photo-1589310243389-96a5483213a8?w=800',
    'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=800',
  ],
  jeans: [
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800',
    'https://images.unsplash.com/photo-1475178626620-a4d074967452?w=800',
    'https://images.unsplash.com/photo-1555689502-c4b22d76c56f?w=800',
  ],
  ethnic: [
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800',
    'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800',
    'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=800',
    'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800',
  ],
  saree: [
    'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800',
    'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800',
    'https://images.unsplash.com/photo-1557989048-00cd98b1f4cf?w=800',
  ],
  womens_top: [
    'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=800',
    'https://images.unsplash.com/photo-1548624313-0396c75e4b1a?w=800',
    'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800',
  ],
  dress: [
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800',
    'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=800',
    'https://images.unsplash.com/photo-1539008835657-9e8e9680c956?w=800',
  ],
  kids_wear: [
    'https://images.unsplash.com/photo-1518831959646-742c3a14ebf7?w=800',
    'https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=800',
    'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?w=800',
  ],
  sneakers: [
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800',
    'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800',
    'https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800',
    'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=800',
  ],
  formal_shoes: [
    'https://images.unsplash.com/photo-1449505278894-297fdb3edbc1?w=800',
    'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=800',
  ],
  slippers: [
    'https://images.unsplash.com/photo-1603487742131-4160ec999306?w=800',
    'https://images.unsplash.com/photo-1599309329365-0a9245a8c058?w=800',
  ],
  skincare: [
    'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800',
    'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800',
    'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=800',
    'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=800',
  ],
  makeup: [
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800',
    'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800',
    'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800',
  ],
  haircare: [
    'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?w=800',
    'https://images.unsplash.com/photo-1526045612212-70caf35c14df?w=800',
  ],
  supplements: [
    'https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=800',
    'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800',
  ],
  refrigerator: [
    'https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=800',
    'https://images.unsplash.com/photo-1622547748225-3fc4abd2cca0?w=800',
  ],
  washing_machine: [
    'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  ac: [
    'https://images.unsplash.com/photo-1580595999172-787970a962d9?w=800',
    'https://images.unsplash.com/photo-1558002038-1055e2dae1e4?w=800',
  ],
  cookware: [
    'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800',
    'https://images.unsplash.com/photo-1585515320310-259814833e62?w=800',
    'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=800',
  ],
  home_decor: [
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800',
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
    'https://images.unsplash.com/photo-1565182999561-18d7dc61c393?w=800',
  ],
  furniture: [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800',
    'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=800',
    'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=800',
    'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800',
  ],
  books: [
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800',
    'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=800',
    'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=800',
  ],
  cricket: [
    'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=800',
    'https://images.unsplash.com/photo-1624526267942-ab0ff8a3e972?w=800',
  ],
  gym: [
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800',
  ],
  cycling: [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
    'https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=800',
  ],
  yoga: [
    'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800',
    'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800',
  ],
  toys: [
    'https://images.unsplash.com/photo-1558060370-d644485927b8?w=800',
    'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=800',
    'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800',
  ],
  baby: [
    'https://images.unsplash.com/photo-1555252333-9f8e92e65df9?w=800',
    'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800',
  ],
  car: [
    'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800',
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
  ],
  gold_jewelry: [
    'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800',
    'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800',
    'https://images.unsplash.com/photo-1603561591411-07134e71a2a9?w=800',
  ],
  fashion_jewelry: [
    'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800',
    'https://images.unsplash.com/photo-1573408301185-9519f94816b5?w=800',
  ],
  watch: [
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
    'https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=800',
    'https://images.unsplash.com/photo-1542496658-e33a6d0d73e2?w=800',
  ],
  handbag: [
    'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800',
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800',
    'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800',
  ],
  backpack: [
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800',
    'https://images.unsplash.com/photo-1622560480605-d83c661063e6?w=800',
  ],
  luggage: [
    'https://images.unsplash.com/photo-1565026057447-bc90a3dceb87?w=800',
    'https://images.unsplash.com/photo-1574701148212-8518165a4bd7?w=800',
  ],
  food_snacks: [
    'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=800',
    'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=800',
  ],
  beverages: [
    'https://images.unsplash.com/photo-1574226516831-e1dff420e562?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  chocolate: [
    'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=800',
    'https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=800',
  ],
  gaming_console: [
    'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=800',
    'https://images.unsplash.com/photo-1580234811497-9df7fd2f357e?w=800',
    'https://images.unsplash.com/photo-1592840062661-a5a7f78e2056?w=800',
  ],
  gaming_gear: [
    'https://images.unsplash.com/photo-1547394765-185e1e68f34e?w=800',
    'https://images.unsplash.com/photo-1587202372616-b43abea06c2a?w=800',
  ],
  pet: [
    'https://images.unsplash.com/photo-1601758124510-52d02ddb7cbd?w=800',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=800',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=800',
  ],
  tools: [
    'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800',
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800',
    'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=800',
  ],
  guitar: [
    'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=800',
    'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=800',
  ],
  piano: [
    'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=800',
    'https://images.unsplash.com/photo-1552422535-c45813c61732?w=800',
  ],
  garden: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800',
    'https://images.unsplash.com/photo-1416431338-0c5e0e31e0e7?w=800',
    'https://images.unsplash.com/photo-1585320806297-9794b3e4aaae?w=800',
  ],
  bridal: [
    'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800',
    'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=800',
  ],
  office: [
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800',
    'https://images.unsplash.com/photo-1453749024858-4bca89bd9edc?w=800',
  ],
  art: [
    'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800',
    'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800',
  ],
  monitor: [
    'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800',
    'https://images.unsplash.com/photo-1585792180666-f7347c490ee2?w=800',
  ],
  speaker: [
    'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=800',
    'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800',
  ],
  router: [
    'https://images.unsplash.com/photo-1606904825846-647eb07f5be2?w=800',
    'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800',
  ],
  ssd: [
    'https://images.unsplash.com/photo-1597852074816-d933c7d2b988?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  printer: [
    'https://images.unsplash.com/photo-1612815292428-08fd5218ef17?w=800',
    'https://images.unsplash.com/photo-1563770660941-20978e870e26?w=800',
  ],
  microwave: [
    'https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  water_purifier: [
    'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  small_appliance: [
    'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  ],
  football: [
    'https://images.unsplash.com/photo-1614632537423-1e6c2e7e0aab?w=800',
    'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800',
  ],
};

// ─── Product templates ────────────────────────────────────────────────────────
// [title, subcategoryKey, rootKey, brand, hsnCode, gstRate, [minMRP,maxMRP], imgKey, hasVariants, weightKg]
const PRODUCT_TEMPLATES = [
  // ── SMARTPHONES ──────────────────────────────────────────────────────────
  ['Samsung Galaxy S24 Ultra 512GB Titanium Black',       'smartphones','electronics','Samsung',     '8517',18,[129999,159999],'smartphone',true, 0.232],
  ['Apple iPhone 15 Pro Max 256GB Natural Titanium',      'smartphones','electronics','Apple',        '8517',18,[159900,174900],'smartphone',true, 0.221],
  ['OnePlus 12 16GB RAM 512GB Silky Black',               'smartphones','electronics','OnePlus',      '8517',18, [64999, 74999],'smartphone',true, 0.220],
  ['Xiaomi 14 Ultra 512GB Black',                         'smartphones','electronics','Xiaomi',       '8517',18, [99999,119999],'smartphone',true, 0.219],
  ['Samsung Galaxy A55 5G 256GB Awesome Iceblue',         'smartphones','electronics','Samsung',      '8517',18, [38999, 45999],'smartphone',true, 0.213],
  ['Realme GT 6 5G 512GB Fluid Silver',                   'smartphones','electronics','Realme',       '8517',18, [42999, 49999],'smartphone',true, 0.199],
  ['Motorola Edge 50 Pro 512GB Midnight Blue',            'smartphones','electronics','Motorola',     '8517',18, [34999, 41999],'smartphone',true, 0.186],
  ['Google Pixel 8a 256GB Aloe Green',                    'smartphones','electronics','Google',       '8517',18, [52999, 62999],'smartphone',true, 0.188],
  ['Nothing Phone 2a 256GB Black',                        'smartphones','electronics','Nothing',      '8517',18, [24999, 31999],'smartphone',true, 0.190],
  ['iQOO Z9 Turbo 5G 8GB+256GB',                         'smartphones','electronics','iQOO',         '8517',18, [23999, 29999],'smartphone',true, 0.200],
  ['Poco X6 Pro 5G 12GB+512GB Yellow',                    'smartphones','electronics','Poco',         '8517',18, [28999, 34999],'smartphone',true, 0.195],
  ['Vivo V30 Pro 5G 512GB Peacock Green',                 'smartphones','electronics','Vivo',         '8517',18, [44999, 52999],'smartphone',true, 0.186],
  ['Lava Blaze 3 5G 8GB+128GB Glass Black',               'smartphones','electronics','Lava',         '8517',18, [11999, 14999],'smartphone',true, 0.180],
  ['Tecno Spark 20 Pro+ 8GB+256GB',                       'smartphones','electronics','Tecno',        '8517',18, [12999, 16999],'smartphone',true, 0.185],
  // ── TABLETS ──────────────────────────────────────────────────────────────
  ['Apple iPad Pro M4 11-inch 256GB WiFi',                'tablets','electronics','Apple',            '8471',18, [99900,119900],'tablet', true, 0.579],
  ['Samsung Galaxy Tab S9 FE 128GB WiFi Gray',            'tablets','electronics','Samsung',          '8471',18, [34999, 42999],'tablet', true, 0.523],
  ['Lenovo Tab M11 4GB+128GB Storm Grey',                 'tablets','electronics','Lenovo',           '8471',18, [17999, 22999],'tablet', true, 0.465],
  ['Xiaomi Pad 6 8GB+256GB Gravity Gray',                 'tablets','electronics','Xiaomi',           '8471',18, [28999, 34999],'tablet', true, 0.490],
  // ── EARPHONES & HEADPHONES ───────────────────────────────────────────────
  ['Apple AirPods Pro 2nd Gen MagSafe',                   'earphones','electronics','Apple',          '8518',18, [24900, 29900],'earphones',true, 0.054],
  ['Sony WH-1000XM5 Wireless Noise Cancelling',           'earphones','electronics','Sony',           '8518',18, [24999, 34999],'earphones',true, 0.250],
  ['boAt Airdopes 141 TWS Earbuds Black',                 'earphones','electronics','boAt',           '8518',18,   [799,  1299],'earphones',true, 0.040],
  ['JBL Tune 770NC Wireless ANC Headphones',              'earphones','electronics','JBL',            '8518',18,  [4999,  7499],'earphones',true, 0.200],
  ['Jabra Elite 10 True Wireless',                        'earphones','electronics','Jabra',          '8518',18, [19999, 27999],'earphones',true, 0.058],
  ['Sennheiser Momentum 4 Wireless Headphones',           'earphones','electronics','Sennheiser',     '8518',18, [29999, 39999],'earphones',true, 0.293],
  ['Noise Buds Connect 2 TWS Black',                      'earphones','electronics','Noise',          '8518',18,   [999,  1799],'earphones',true, 0.035],
  // ── SMARTWATCHES ─────────────────────────────────────────────────────────
  ['Apple Watch Ultra 2 49mm GPS+Cellular Titanium',      'smartwatches','electronics','Apple',       '9102',18, [89900, 99900],'smartwatch',true,0.061],
  ['Samsung Galaxy Watch 7 44mm Silver',                  'smartwatches','electronics','Samsung',     '9102',18, [29999, 37999],'smartwatch',true,0.033],
  ['Garmin Fenix 7 Pro Solar GPS Multisport Watch',       'smartwatches','electronics','Garmin',      '9102',18, [74999, 94999],'smartwatch',true,0.049],
  ['boAt Wave Flex Connect Smartwatch',                   'smartwatches','electronics','boAt',         '9102',18,  [1499,  2499],'smartwatch',true,0.045],
  ['Noise ColorFit Pro 5 Max AMOLED Watch',               'smartwatches','electronics','Noise',       '9102',18,  [2999,  4499],'smartwatch',true,0.042],
  ['Fire-Boltt Ring 3 Smartwatch Black',                  'smartwatches','electronics','Fire-Boltt',  '9102',18,  [1799,  2799],'smartwatch',true,0.045],
  // ── CAMERAS ──────────────────────────────────────────────────────────────
  ['Sony Alpha 7 IV Full Frame Mirrorless Body',          'cameras-photo','electronics','Sony',       '9006',18, [249999,279999],'camera',false,0.659],
  ['Canon EOS R8 Mirrorless Camera Body',                 'cameras-photo','electronics','Canon',      '9006',18, [159999,179999],'camera',false,0.461],
  ['Nikon Z fc DX Mirrorless with 28mm Lens',             'cameras-photo','electronics','Nikon',      '9006',18, [89999,109999], 'camera',false,0.390],
  ['GoPro HERO12 Black Action Camera',                    'cameras-photo','electronics','GoPro',      '9006',18, [32999, 42999],'camera',true, 0.154],
  // ── LAPTOPS ──────────────────────────────────────────────────────────────
  ['Apple MacBook Air M3 15-inch 256GB Midnight',         'laptops','computers','Apple',              '8471',18, [134900,154900],'laptop',false,1.510],
  ['Dell XPS 15 Intel Core Ultra 7 512GB SSD',            'laptops','computers','Dell',               '8471',18, [149999,179999],'laptop',false,1.860],
  ['HP Spectre x360 14 OLED Intel i7 1TB',               'laptops','computers','HP',                 '8471',18, [149999,179999],'laptop',false,1.340],
  ['Lenovo Legion 5i Gen 9 RTX 4070 16GB',               'laptops','computers','Lenovo',             '8471',18, [109999,139999],'laptop',false,2.400],
  ['Asus ROG Zephyrus G14 AMD Ryzen 9',                   'laptops','computers','Asus',              '8471',18, [119999,149999],'laptop',false,1.650],
  ['Acer Nitro V 15 RTX 4060 16GB RAM',                  'laptops','computers','Acer',               '8471',18, [79999, 99999],'laptop',false,2.200],
  ['Microsoft Surface Laptop 6 Intel Core Ultra 5',      'laptops','computers','Microsoft',          '8471',18, [119999,149999],'laptop',false,1.340],
  ['Avita Pura NS14A6 AMD Ryzen 5 512GB',                'laptops','computers','Avita',              '8471',18, [34999, 44999],'laptop',false,1.650],
  // ── MONITORS ─────────────────────────────────────────────────────────────
  ['Samsung 27 Inch QHD IPS 144Hz Gaming Monitor',       'monitors','computers','Samsung',           '8528',28, [24999, 34999],'monitor',false,5.100],
  ['LG 32 Inch UltraWide WQHD IPS Monitor',              'monitors','computers','LG',                '8528',28, [32999, 42999],'monitor',false,7.300],
  ['Dell S2722QC 27 Inch 4K USB-C Monitor',              'monitors','computers','Dell',              '8528',28, [34999, 44999],'monitor',false,5.800],
  // ── PRINTERS ─────────────────────────────────────────────────────────────
  ['HP DeskJet 2878 All-in-One Printer',                 'printers','computers','HP',                '8443',18,  [4999,  7999],'printer',false,4.500],
  ['Epson EcoTank L3252 All-in-One Ink Tank',            'printers','computers','Epson',             '8443',18,  [9999, 13999],'printer',false,3.700],
  // ── TELEVISIONS ──────────────────────────────────────────────────────────
  ['Samsung 65 Inch Neo QLED 4K Smart TV QN90D',         'televisions','tv-audio','Samsung',         '8528',28, [119999,159999],'tv',false,26.500],
  ['LG 55 Inch OLED C4 4K evo Smart TV',                 'televisions','tv-audio','LG',              '8528',28, [109999,149999],'tv',false,17.000],
  ['Sony Bravia 7 65 Inch 4K Mini LED TV',               'televisions','tv-audio','Sony',            '8528',28, [119999,154999],'tv',false,25.000],
  ['TCL 55 Inch C745 QLED 144Hz Google TV',              'televisions','tv-audio','TCL',             '8528',28, [59999, 79999],'tv',false,14.000],
  ['OnePlus 43 Inch Y3 Full HD Smart TV',                'televisions','tv-audio','OnePlus',         '8528',28, [19999, 25999],'tv',false, 8.000],
  ['Hisense 75 Inch 4K ULED Mini-LED U7K TV',            'televisions','tv-audio','Hisense',         '8528',28, [89999,119999],'tv',false,35.000],
  // ── SPEAKERS ─────────────────────────────────────────────────────────────
  ['Sony HT-A7000 7.1.2ch Soundbar Dolby Atmos',        'home-audio','tv-audio','Sony',              '8518',18, [74999, 94999],'speaker',false,6.600],
  ['JBL Bar 1000 Pro 7.1.4 Soundbar 880W',              'home-audio','tv-audio','JBL',               '8518',18, [74999, 99999],'speaker',false,8.300],
  ['boAt Aavante Bar 2200D 220W Soundbar',               'portable-speakers','tv-audio','boAt',       '8518',18,  [5999,  8999],'speaker',false,3.200],
  ['Marshall Emberton III Portable Bluetooth Speaker',   'portable-speakers','tv-audio','Marshall',   '8518',18,  [9999, 14999],'speaker',false,0.710],
  // ── MEN'S T-SHIRTS ───────────────────────────────────────────────────────
  ["H&M Men's Regular Fit Crew-Neck T-Shirt White",      'mens-tshirts','mens-fashion','H&M',         '6109',5,    [499,   799],'mens_tshirt',true,0.200],
  ["US Polo Assn. Men's Solid Polo T-Shirt",             'mens-tshirts','mens-fashion','US Polo Assn.','6109',5,   [799,  1499],'mens_tshirt',true,0.220],
  ["Roadster Men's Oversized Graphic T-Shirt",           'mens-tshirts','mens-fashion','Roadster',    '6109',5,    [499,   899],'mens_tshirt',true,0.200],
  ["Arrow Men's Regular Fit V-Neck T-Shirt",             'mens-tshirts','mens-fashion','Arrow',        '6109',5,   [699,  1099],'mens_tshirt',true,0.200],
  ["PUMA Men's ESS+ Tape T-Shirt",                       'mens-tshirts','mens-fashion','PUMA',         '6109',5,   [999,  1699],'mens_tshirt',true,0.180],
  // ── MEN'S SHIRTS ─────────────────────────────────────────────────────────
  ["Van Heusen Men's Slim Fit Formal Shirt White",       'mens-shirts','mens-fashion','Van Heusen',   '6205',5,    [999,  1799],'mens_shirt',true,0.220],
  ["Allen Solly Men's Regular Fit Printed Shirt",        'mens-shirts','mens-fashion','Allen Solly',  '6205',5,   [799,  1499],'mens_shirt',true,0.210],
  ["Jack & Jones Men's Slim Fit Casual Shirt",           'mens-shirts','mens-fashion','Jack & Jones', '6205',5,   [999,  1999],'mens_shirt',true,0.220],
  ["Wrangler Men's Regular Fit Check Shirt",             'mens-shirts','mens-fashion','Wrangler',     '6205',5,   [899,  1599],'mens_shirt',true,0.230],
  // ── MEN'S JEANS ──────────────────────────────────────────────────────────
  ["Levi's 511 Slim Fit Jeans Dark Blue",                'mens-jeans','mens-fashion',"Levi's",        '6203',12, [2499,  3999],'jeans',true, 0.600],
  ["Pepe Jeans London Men's Slim Fit Jeans",             'mens-jeans','mens-fashion','Pepe Jeans',    '6203',12, [1999,  3499],'jeans',true, 0.580],
  ["Lee Men's Regular Fit Straight Jeans",               'mens-jeans','mens-fashion','Lee',           '6203',12, [2499,  3999],'jeans',true, 0.620],
  ["Wrangler Men's Regular Stretch Cargo Pants",         'mens-jeans','mens-fashion','Wrangler',      '6203',12, [1499,  2499],'jeans',true, 0.520],
  // ── MEN'S ETHNIC ─────────────────────────────────────────────────────────
  ["Manyavar Men's Embroidered Silk Sherwani Set",       'mens-ethnic','mens-fashion','Manyavar',     '6109',12, [5999, 14999],'ethnic',false,0.800],
  ["Fabindia Men's Pure Cotton Kurta White",             'mens-ethnic','mens-fashion','Fabindia',     '6109',12, [1299,  2499],'ethnic',false,0.350],
  ["Raymond Men's Regular Fit Kurta Pyjama Set",         'mens-ethnic','mens-fashion','Raymond',      '6109',12, [2499,  4999],'ethnic',false,0.450],
  // ── SAREES ───────────────────────────────────────────────────────────────
  ["Kanchipuram Pure Silk Saree with Blouse Piece",      'sarees','womens-fashion','Nalli',           '5007',5,  [8999, 24999],'saree', false,0.600],
  ["Banarasi Georgette Embroidered Saree Magenta",       'sarees','womens-fashion','Saree Mall',      '5007',5,  [2999,  6999],'saree', false,0.500],
  ["Fabindia Cotton Silk Printed Saree Blue",            'sarees','womens-fashion','Fabindia',        '5007',5,  [1999,  3499],'saree', false,0.450],
  ["Soch Women's Net Embellished Saree Red",             'sarees','womens-fashion','Soch',            '5007',5,  [3499,  7999],'saree', false,0.520],
  // ── KURTAS & SUITS ───────────────────────────────────────────────────────
  ["W for Woman Anarkali Cotton Kurta Blue",             'kurtas-suits','womens-fashion','W',          '6104',5,   [799,  1499],'ethnic',false,0.300],
  ["Biba Women's Floral Printed Kurta with Dupatta",     'kurtas-suits','womens-fashion','Biba',       '6104',5,  [1299,  2799],'ethnic',false,0.400],
  ["Aurelia Women's Straight Printed Kurta Pink",        'kurtas-suits','womens-fashion','Aurelia',   '6104',5,   [799,  1799],'ethnic',false,0.320],
  ["Libas Women's Embroidered Straight Kurta Set",       'kurtas-suits','womens-fashion','Libas',      '6104',5,  [1499,  2999],'ethnic',false,0.380],
  // ── DRESSES ──────────────────────────────────────────────────────────────
  ["H&M Women's Maxi Slip Dress Black",                  'dresses','womens-fashion','H&M',            '6204',12, [1499,  2499],'dress', false,0.350],
  ["AND Women's Wrap Maxi Dress Floral",                 'dresses','womens-fashion','AND',            '6204',12, [1999,  3499],'dress', false,0.380],
  ["Mango Women's Cut-Out Bodycon Dress",                'dresses','womens-fashion','Mango',          '6204',12, [2999,  5999],'dress', false,0.320],
  ["Zara Women's Midi Satin Dress Blue",                 'dresses','womens-fashion','Zara',           '6204',12, [2499,  4499],'dress', false,0.340],
  // ── WOMEN'S TOPS ─────────────────────────────────────────────────────────
  ["H&M Women's Ribbed Off-Shoulder Top",                'western-tops','womens-fashion','H&M',       '6106',5,   [599,   999],'womens_top',false,0.180],
  ["Zara Women's Satin Cropped Blouse White",            'western-tops','womens-fashion','Zara',      '6106',5,  [1499,  2499],'womens_top',false,0.160],
  ["Global Desi Women's Bohemian Printed Top",           'western-tops','womens-fashion','Global Desi','6106',5,  [499,   999],'womens_top',false,0.180],
  // ── BOYS' CLOTHING ───────────────────────────────────────────────────────
  ["H&M Boys' Regular Fit Jeans 8-14Y",                 'boys-clothing','kids-fashion','H&M',         '6203',12,  [799,  1299],'kids_wear',true, 0.300],
  ["US Polo Assn. Boys' Polo T-Shirt 7-16Y",            'boys-clothing','kids-fashion','US Polo Assn.','6109',5,  [599,   999],'kids_wear',true, 0.150],
  ["Zara Boys' Cargo Trousers 6-14Y",                   'boys-clothing','kids-fashion','Zara',        '6203',12,  [999,  1799],'kids_wear',true, 0.280],
  // ── GIRLS' CLOTHING ──────────────────────────────────────────────────────
  ["H&M Girls' Tiered Dress 4-12Y Pink",                'girls-clothing','kids-fashion','H&M',        '6204',12,  [799,  1299],'kids_wear',false,0.200],
  ["Fabindia Girls' Printed Kurta Set 6-12Y",           'girls-clothing','kids-fashion','Fabindia',   '6104',5,   [799,  1499],'kids_wear',false,0.250],
  // ── MEN'S SHOES ──────────────────────────────────────────────────────────
  ["Nike Air Max 270 Men's Running Shoes Black",         'mens-shoes','footwear','Nike',              '6403',18, [7999, 12999],'sneakers',true, 0.320],
  ["Adidas Ultraboost 22 Men's Running Shoes",           'mens-shoes','footwear','Adidas',            '6403',18, [8999, 14999],'sneakers',true, 0.330],
  ["Bata Men's Formal Oxford Shoes Black",               'mens-shoes','footwear','Bata',              '6403',18, [1499,  2999],'formal_shoes',true,0.400],
  ["Woodland Men's Leather Casual Boat Shoes",           'mens-shoes','footwear','Woodland',          '6403',18, [2999,  5499],'formal_shoes',true,0.420],
  ["Puma Men's Future Rider Sneakers White",             'mens-shoes','footwear','Puma',              '6403',18, [3499,  5499],'sneakers',true, 0.300],
  // ── WOMEN'S SHOES ────────────────────────────────────────────────────────
  ["Skechers Women's Go Walk 6 Slip-On Shoes",          'womens-shoes','footwear','Skechers',         '6404',18, [3499,  5499],'sneakers',true, 0.290],
  ["Steve Madden Women's Pointed Block Heel",            'womens-shoes','footwear','Steve Madden',    '6403',18, [4499,  8999],'formal_shoes',true,0.450],
  ["Metro Women's Embellished Block Heel Sandals",       'womens-shoes','footwear','Metro Shoes',     '6403',18, [1499,  2999],'formal_shoes',true,0.380],
  // ── SPORTS SHOES ─────────────────────────────────────────────────────────
  ["Nike Pegasus 41 Men's Road Running Shoes",          'sports-outdoor-shoes','footwear','Nike',     '6404',18, [9999, 14999],'sneakers',true, 0.290],
  ["ASICS Gel-Nimbus 26 Men's Running",                 'sports-outdoor-shoes','footwear','ASICS',    '6404',18, [12999, 17999],'sneakers',true,0.300],
  ["Campus Radiate-L Men's Sports Shoes",               'sports-outdoor-shoes','footwear','Campus',   '6404',12, [1299,  2499],'sneakers',true, 0.280],
  // ── SLIPPERS ─────────────────────────────────────────────────────────────
  ["Crocs Classic Clog Unisex Navy Blue",               'slippers','footwear','Crocs',                '6402',18, [2299,  3999],'slippers',true, 0.300],
  ["Paragon Men's Extra Soft Flip Flops",               'slippers','footwear','Paragon',              '6404',12,   [199,   399],'slippers',true, 0.200],
  ["Havaianas Top Unisex Thong Sandals",                'slippers','footwear','Havaianas',            '6402',18, [1499,  2499],'slippers',true, 0.160],
  // ── SKINCARE ─────────────────────────────────────────────────────────────
  ["Minimalist 2% Salicylic Acid Body Wash 250ml",      'skincare','beauty','Minimalist',             '3304',18,  [599,   849],'skincare',true, 0.260],
  ["Mamaearth Ubtan Face Wash 100ml Turmeric",          'skincare','beauty','Mamaearth',              '3306',18,  [249,   399],'skincare',false,0.120],
  ["Cetaphil Moisturising Cream 250g",                  'skincare','beauty','Cetaphil',               '3304',18,  [499,   699],'skincare',false,0.260],
  ["The Derma Co 10% Niacinamide Face Serum 30ml",      'skincare','beauty','The Derma Co',           '3304',18,  [699,   999],'skincare',false,0.040],
  ["Forest Essentials Luminous Forever Eye Gel",        'skincare','beauty','Forest Essentials',      '3304',18, [1099,  2499],'skincare',false,0.030],
  ["Plum E-Luminence Simply Supple Body Lotion",        'skincare','beauty','Plum',                   '3304',18,  [399,   599],'skincare',false,0.300],
  ["Dot & Key Watermelon Hyaluronic Sunscreen SPF 50",  'skincare','beauty','Dot & Key',              '3304',18,  [499,   799],'skincare',false,0.050],
  // ── MAKEUP ───────────────────────────────────────────────────────────────
  ["Lakme 9to5 Weightless Mousse Foundation",           'makeup','beauty','Lakme',                    '3304',18,  [499,   699],'makeup',true, 0.060],
  ["Maybelline Fit Me Matte+Poreless Foundation 20ml",  'makeup','beauty','Maybelline',               '3304',18,  [399,   699],'makeup',true, 0.060],
  ["Sugar Cosmetics Matte Attack Transferproof Lipstick",'makeup','beauty','Sugar Cosmetics',         '3304',18,  [399,   599],'makeup',true, 0.010],
  ["NYX Professional Makeup Lip Liner",                 'makeup','beauty','NYX Professional',         '3304',18,  [299,   549],'makeup',true, 0.008],
  ["Charlotte Tilbury Pillow Talk Lipstick",            'makeup','beauty','Charlotte Tilbury',        '3304',18, [3499,  4999],'makeup',true, 0.012],
  ["L.A. Girl Pro Coverage HD Illuminating Foundation", 'makeup','beauty','L.A. Girl',               '3304',18,  [599,   899],'makeup',true, 0.070],
  // ── HAIRCARE ─────────────────────────────────────────────────────────────
  ["WOW Skin Science Biotin & Collagen Shampoo 300ml",  'haircare','beauty','WOW Skin Science',       '3305',18,  [449,   699],'haircare',false,0.320],
  ["Pantene Advanced Hairfall Solution Shampoo 1L",     'haircare','beauty','Pantene',                '3305',18,  [499,   699],'haircare',false,0.960],
  ["Tresemme Keratin Smooth Conditioner 580ml",         'haircare','beauty','TRESemmé',               '3305',18,  [399,   549],'haircare',false,0.610],
  ["Streax Ultradazzle Serum with Walnut Oil 45ml",     'haircare','beauty','Streax',                 '3305',18,  [149,   249],'haircare',false,0.060],
  // ── VITAMINS & SUPPLEMENTS ───────────────────────────────────────────────
  ["Muscleblaze Biozyme Performance Whey 2kg",          'vitamins-supplements','health-wellness','Muscleblaze','2106',18,[3999, 5499],'supplements',false,2.100],
  ["Fast&Up Charge Vitamin C 1000mg 20 Tablets",        'vitamins-supplements','health-wellness','Fast&Up',    '2936',12, [399,  599],'supplements',false,0.040],
  ["HealthKart HK Vitals Multivitamin 60 Tablets",      'vitamins-supplements','health-wellness','HealthKart', '2936',12, [599,  899],'supplements',false,0.080],
  ["Oziva Protein & Herbs Womens Vanilla 1kg",          'vitamins-supplements','health-wellness','OZiva',      '2106',18,[2499, 3499],'supplements',false,1.050],
  // ── WASHING MACHINES ─────────────────────────────────────────────────────
  ["Samsung 8 Kg Fully Automatic Front Load 1400RPM",   'washing-machines','appliances','Samsung',    '8450',28, [49999, 64999],'washing_machine',false,63.0],
  ["LG 7 Kg 5 Star Semi-Automatic Washing Machine",     'washing-machines','appliances','LG',         '8450',28, [14999, 19999],'washing_machine',false,31.0],
  ["Whirlpool 6.5 Kg 5 Star Top Load Washing Machine",  'washing-machines','appliances','Whirlpool',  '8450',28, [19999, 25999],'washing_machine',false,35.0],
  // ── REFRIGERATORS ────────────────────────────────────────────────────────
  ["Samsung 580 Litre French Door Refrigerator",        'refrigerators','appliances','Samsung',        '8418',28, [69999, 89999],'refrigerator',false,90.0],
  ["LG 190 Litre 5 Star Direct Cool Refrigerator",      'refrigerators','appliances','LG',            '8418',28, [17999, 22999],'refrigerator',false,32.0],
  ["Haier 320 Litre Double Door Refrigerator",          'refrigerators','appliances','Haier',          '8418',28, [29999, 39999],'refrigerator',false,55.0],
  // ── AIR CONDITIONERS ─────────────────────────────────────────────────────
  ["Daikin 1.5 Ton 5 Star Inverter Split AC 2024",      'air-conditioners','appliances','Daikin',      '8415',28, [42999, 54999],'ac',false,26.0],
  ["Voltas 1.5 Ton 3 Star Inverter Split AC",           'air-conditioners','appliances','Voltas',      '8415',28, [34999, 44999],'ac',false,24.0],
  ["Blue Star 1 Ton 5 Star Inverter Split AC",          'air-conditioners','appliances','Blue Star',   '8415',28, [36999, 46999],'ac',false,22.0],
  // ── MICROWAVE OVENS ──────────────────────────────────────────────────────
  ["IFB 30 Litre Convection Microwave Oven",            'microwave-ovens','appliances','IFB',          '8516',28, [11999, 16999],'microwave',false,14.8],
  ["Samsung 28 Litre Convection Microwave Oven MG28",   'microwave-ovens','appliances','Samsung',      '8516',28, [12999, 17999],'microwave',false,13.5],
  // ── SMALL APPLIANCES ─────────────────────────────────────────────────────
  ["Philips 1200W Dry Iron GC1905",                     'small-appliances','appliances','Philips',     '8516',18,  [799,  1299],'small_appliance',false,1.200],
  ["Inalsa Robot INOX 1000W Mixer Grinder 3 Jars",      'small-appliances','appliances','Inalsa',      '8509',18, [2999,  4499],'small_appliance',false,4.800],
  ["Crompton Aura 35W Ceiling Fan White",               'fans-coolers','appliances','Crompton',        '8414',18,  [999,  1799],'small_appliance',false,3.200],
  // ── COOKWARE ─────────────────────────────────────────────────────────────
  ["Prestige Svachh Hard Anodised Deep Kadai 26cm",     'cookware','home-kitchen','Prestige',          '7323',18, [1499,  2499],'cookware',false,1.200],
  ["Hawkins Futura Non-Stick Flat Tawa 25cm",           'cookware','home-kitchen','Hawkins',           '7323',18,  [799,  1299],'cookware',false,0.700],
  ["Meyer Trivantage 4-piece Cookware Set",             'cookware','home-kitchen','Meyer',             '7323',18, [3999,  5999],'cookware',false,2.800],
  ["Borosil Vision Toughened Glass Casserole 1L",       'cookware','home-kitchen','Borosil',           '7323',18,  [499,   799],'cookware',false,0.800],
  ["Pigeon Aluminium Pressure Cooker 5L",               'cookware','home-kitchen','Pigeon',            '7323',18, [1199,  1999],'cookware',false,1.800],
  // ── HOME DECOR ───────────────────────────────────────────────────────────
  ["Fabindia Handblock Print Cotton Cushion Cover 4pc", 'home-textiles','home-kitchen','Fabindia',     '6302',5,  [599,  1099],'home_decor',false,0.300],
  ["The White Willow Memory Foam Sleeping Pillow",      'home-textiles','home-kitchen','The White Willow','9404',18,[699, 1299],'home_decor',false,0.800],
  ["Home Centre Splendor Glass Vase Gold 30cm",         'home-decor','home-kitchen','Home Centre',     '7013',18,  [699,  1299],'home_decor',false,0.600],
  // ── FURNITURE ────────────────────────────────────────────────────────────
  ["Wakefit Orthopedic Memory Foam Mattress Queen 6in", 'bedroom-furniture','furniture','Wakefit',     '9404',18, [12999, 18999],'furniture',false,28.0],
  ["Pepperfry Clifton 6-Seater Dining Table Walnut",   'dining-furniture','furniture','Pepperfry',     '9403',18, [24999, 34999],'furniture',false,65.0],
  ["Nilkamal Plastic Arm Chair Weather Blue",           'living-room-furniture','furniture','Nilkamal', '9401',18,  [1499,  2499],'furniture',false,4.200],
  ["Durian Lilly 3-Seater Fabric Sofa Light Grey",     'living-room-furniture','furniture','Durian',   '9401',18, [24999, 44999],'furniture',false,80.0],
  ["Godrej Interio Slimline Metal Wardrobe 4-door",    'bedroom-furniture','furniture','Godrej Interio','9403',18, [14999, 22999],'furniture',false,90.0],
  ["Featherlite Study Table Woodpecker 120cm",         'office-study-furniture','furniture','Featherlite','9403',18,[5999, 9999],'furniture',false,18.0],
  // ── BOOKS ────────────────────────────────────────────────────────────────
  ['Atomic Habits — James Clear Paperback',             'non-fiction','books','Penguin Books',         '4901',0,    [399,   499],'books',false,0.300],
  ['The Psychology of Money — Morgan Housel',           'non-fiction','books','Jaico Publishing',      '4901',0,    [249,   399],'books',false,0.250],
  ['Rich Dad Poor Dad — Robert Kiyosaki',               'non-fiction','books','Manjul Publishing',     '4901',0,    [199,   349],'books',false,0.220],
  ['Harry Potter Box Set 1-7 Paperback',                'fiction-literature','books','Bloomsbury',     '4901',0,   [2999,  3999],'books',false,3.000],
  ['NCERT Class 12 Physics Part 1&2 Set',               'academic-books','books','NCERT',             '4901',0,    [299,   399],'books',false,0.800],
  ['Wings of Fire — APJ Abdul Kalam',                   'non-fiction','books','Orient Paperbacks',    '4901',0,    [149,   249],'books',false,0.200],
  // ── CRICKET ──────────────────────────────────────────────────────────────
  ['SG Cricket Bat English Willow Grade 4 Long Blade', 'cricket','sports','SG',                       '9506',18, [2999,  5999],'cricket',false,1.250],
  ['SS Ton Reserve Edition Cricket Bat Kashm. Willow', 'cricket','sports','SS Ton',                   '9506',18, [1999,  3499],'cricket',false,1.200],
  ['Kookaburra Pace Cricket Ball Red 156g Pack 3',     'cricket','sports','Kookaburra',               '9506',18,  [599,   999],'cricket',false,0.468],
  ['MRF Chase Master Batting Pad Cotton Junior',       'cricket','sports','MRF',                      '9506',18,  [999,  1799],'cricket',false,0.450],
  // ── GYM & FITNESS ────────────────────────────────────────────────────────
  ['Lifelong 5kg Rubber Hex Dumbbell Pair',            'gym-fitness','sports','Lifelong',              '9506',18, [1499,  2499],'gym',false,10.0],
  ['Boldfit Pro 32-inch Ab Wheel with Push-Up Bar',    'gym-fitness','sports','Boldfit',               '9506',18,  [599,   999],'gym',false,0.900],
  ["Nike Training Dri-FIT Men's T-Shirt Grey",         'gym-fitness','sports','Nike',                  '6109',5,  [1999,  2999],'gym',true, 0.200],
  ['Strauss 7.5 Litre Water Bottle BPA-Free',          'gym-fitness','sports','Strauss',               '3924',18,  [299,   499],'gym',false,0.200],
  // ── YOGA ─────────────────────────────────────────────────────────────────
  ['Boldfit Pro Yoga Mat 6mm Non-Slip Purple',         'yoga','sports','Boldfit',                      '9506',18,  [799,  1299],'yoga',false,1.100],
  ['Strauss Yoga Block Eva Foam Set of 2',             'yoga','sports','Strauss',                      '9506',18,  [349,   599],'yoga',false,0.250],
  // ── BADMINTON ────────────────────────────────────────────────────────────
  ['Yonex Astrox 88D Game Badminton Racquet',          'badminton','sports','Yonex',                  '9506',18, [7999, 12999],'gym',false,0.083],
  ['Victor Bravesword 12 Badminton Racquet',           'badminton','sports','Victor',                  '9506',18, [3999,  6999],'gym',false,0.088],
  // ── FOOTBALL ─────────────────────────────────────────────────────────────
  ['Nivia Trainer Football Size 5 Orange',             'football','sports','Nivia',                    '9506',18,  [499,   899],'football',false,0.420],
  ['Nike Strike Football Pitch Dark Blue',             'football','sports','Nike',                     '9506',18, [2499,  3999],'football',false,0.440],
  // ── EDUCATIONAL TOYS ─────────────────────────────────────────────────────
  ['LEGO Classic Large Creative Brick Box 11006',      'educational-toys','toys','LEGO',               '9503',18, [2999,  4499],'toys',false,0.620],
  ['Funskool Monopoly Classic Board Game',             'educational-toys','toys','Funskool',           '9504',18,  [699,   999],'toys',false,0.750],
  ['Skillmatics Spot It! Pattern Recognition Game',   'educational-toys','toys','Skillmatics',        '9504',18,  [499,   799],'toys',false,0.300],
  // ── SOFT TOYS ────────────────────────────────────────────────────────────
  ['Mirada Soft Teddy Bear 50cm Brown',               'soft-toys','toys','Mirada',                    '9503',12,  [499,   799],'toys',false,0.300],
  ['Hamleys Giant Panda Plush Soft Toy 50cm',         'soft-toys','toys','Hamleys',                   '9503',12, [1499,  2499],'toys',false,0.500],
  // ── BABY PRODUCTS ────────────────────────────────────────────────────────
  ['Pampers New Baby Taped Diapers NB 72pcs',         'baby-products','toys','Pampers',               '9619',12,  [499,   799],'baby',false,0.600],
  ['Mee Mee Premium Baby Pillow Anti-flat Head',      'baby-products','toys','Mee Mee',               '9404',18,  [499,   799],'baby',false,0.250],
  ['Chicco Warm Wipes 3 Pack 216 Pieces',             'baby-products','toys','Chicco',                '9619',12,  [699,   999],'baby',false,0.648],
  // ── CAR ACCESSORIES ──────────────────────────────────────────────────────
  ['Vega Crux Isi Helmet Open Face Black M',          'bike-accessories','automotive','Vega',          '6506',28, [999,   1999],'car',false,1.200],
  ['Michelin 12" Premium Tyre Pressure Gauge',        'tyres-batteries','automotive','Michelin',       '9026',18, [499,    899],'car',false,0.120],
  ['Portronics Car Power Mini 5 Car Charger 5in1',   'car-accessories','automotive','Portronics',     '8504',18, [499,    999],'car',false,0.080],
  ['70Mai Dash Cam Pro Plus+ A500S 2.7K',             'car-electronics','automotive','70mai',          '8525',18, [9999, 13999],'car',false,0.072],
  // ── GOLD JEWELLERY ───────────────────────────────────────────────────────
  ['Tanishq 22K Gold Lakshmi Coin 4g',                'gold-jewelry','jewelry','Tanishq',              '7108',3,  [22999, 25999],'gold_jewelry',false,0.010],
  ['Mia by Tanishq 14K Gold Diamond Solitaire Ring', 'gold-jewelry','jewelry','Mia by Tanishq',       '7113',3,  [12999, 24999],'gold_jewelry',false,0.003],
  ['PC Jeweller 22K Gold Stud Earrings 2g',           'gold-jewelry','jewelry','PC Jeweller',         '7113',3,  [11999, 14999],'gold_jewelry',false,0.002],
  // ── FASHION JEWELLERY ────────────────────────────────────────────────────
  ['Zaveri Pearls Kundan Choker Necklace Set',        'fashion-jewelry','jewelry','Zaveri Pearls',     '7117',5,   [799,  1499],'fashion_jewelry',false,0.100],
  ['Shining Diva Fashion Oxidised Silver Bangles 6pc','fashion-jewelry','jewelry','Shining Diva',     '7117',5,   [399,   799],'fashion_jewelry',false,0.080],
  // ── WATCHES ──────────────────────────────────────────────────────────────
  ['Titan Raga 18K Gold Plated Analog Watch Women',  'womens-watches','watches','Titan',               '9102',18, [3999,  7999],'watch',false,0.060],
  ['Fossil Gen 6 Smartwatch Touchscreen Men',        'mens-watches','watches','Fossil',               '9102',18, [14999, 22999],'watch',false,0.049],
  ['Casio G-Shock GA-2100 Carbon Core Guard Watch', 'mens-watches','watches','Casio',                 '9102',18, [7999, 12999],'watch',false,0.056],
  ['HMT Janata Mechanical Winding Mens Watch',       'mens-watches','watches','HMT',                  '9102',18, [1499,  2999],'watch',false,0.065],
  // ── HANDBAGS ─────────────────────────────────────────────────────────────
  ['Lavie Zara Large Tote Bag for Women Black',      'handbags','bags-luggage','Lavie',                '4202',18, [1499,  2999],'handbag',false,0.450],
  ['Hidesign Leather Tote Bag Women Tan',            'handbags','bags-luggage','Hidesign',             '4202',18, [3999,  6999],'handbag',false,0.600],
  ['Baggit Zip Closure Shoulder Bag Women',          'handbags','bags-luggage','Baggit',               '4202',18, [1199,  2299],'handbag',false,0.380],
  // ── BACKPACKS ────────────────────────────────────────────────────────────
  ['Skybags Bingo 02 School Backpack 30L Blue',      'backpacks','bags-luggage','Skybags',             '4202',18, [999,   1999],'backpack',false,0.550],
  ['American Tourister Citi Pro Laptop Backpack 32L','backpacks','bags-luggage','American Tourister',  '4202',18, [1999,  3499],'backpack',false,0.700],
  ['Tommy Hilfiger Polished PU Backpack Men',        'backpacks','bags-luggage','Tommy Hilfiger',      '4202',18, [4999,  7999],'backpack',false,0.600],
  // ── LUGGAGE ──────────────────────────────────────────────────────────────
  ['VIP Alfa Plus 4W Hard Trolley 55cm Cabin Navy',  'luggage','bags-luggage','VIP',                  '4202',18, [2999,  4999],'luggage',false,3.100],
  ['Safari Pronto 8W 55cm Cabin Hard Case Blue',     'luggage','bags-luggage','Safari',                '4202',18, [3499,  5499],'luggage',false,2.900],
  ['Skybags Torque 4W Check-in 75cm Luggage Grey',   'luggage','bags-luggage','Skybags',              '4202',18, [4999,  7999],'luggage',false,4.200],
  // ── FOOD & SNACKS ────────────────────────────────────────────────────────
  ['Haldiram Aloo Bhujia 1kg Premium Pack',          'snacks-namkeen','food-beverages','Haldiram\'s',  '2106',18,  [299,   449],'food_snacks',false,1.000],
  ['Too Yumm! Multigrain Thins Masala 140g',         'snacks-namkeen','food-beverages','Too Yumm!',   '2106',18,   [49,    89],'food_snacks',false,0.140],
  ['Bournvita Pro Health Powder 750g Chocolate',     'beverages','food-beverages','Cadbury',           '1901',18,  [399,   549],'beverages',false,0.760],
  ['Tata Tea Gold 500g Rich Flavour',                'beverages','food-beverages','Tata Tea',          '0902',5,   [219,   299],'beverages',false,0.510],
  ['Nescafe Classic Instant Coffee 100g',            'beverages','food-beverages','Nescafe',           '2101',12,  [299,   399],'beverages',false,0.110],
  ['Kissan Mixed Fruit Jam 500g',                    'condiments-spices','food-beverages','Kissan',    '2007',12,  [149,   219],'food_snacks',false,0.520],
  ['Cadbury Dairy Milk Silk 330g Gift Box',          'chocolate-sweets','food-beverages','Cadbury',   '1806',28,  [299,   449],'chocolate',false,0.340],
  ['Ferrero Rocher 24pc Gift Box 300g',              'chocolate-sweets','food-beverages','Ferrero',   '1806',28,  [699,   999],'chocolate',false,0.300],
  // ── GAMING ───────────────────────────────────────────────────────────────
  ['Sony PlayStation 5 Slim Disc Edition Console',   'consoles','gaming','Sony',                      '9504',18, [44999, 54999],'gaming_console',false,3.600],
  ['Microsoft Xbox Series X 1TB Console Black',      'consoles','gaming','Microsoft',                  '9504',18, [44990, 54990],'gaming_console',false,4.450],
  ['Nintendo Switch OLED White Joy-Con',             'consoles','gaming','Nintendo',                   '9504',18, [29999, 35999],'gaming_console',false,0.420],
  ['Razer DeathAdder V3 HyperSpeed Wireless Mouse',  'pc-gaming','gaming','Razer',                    '8471',18, [7999, 11999],'gaming_gear',false,0.084],
  ['HyperX Alloy Origins Core TKL Mech Keyboard',   'pc-gaming','gaming','HyperX',                   '8471',18, [6999, 10999],'gaming_gear',false,0.798],
  // ── PET SUPPLIES ─────────────────────────────────────────────────────────
  ['Pedigree Adult Chicken & Vegetable Dry Dog Food 10kg','dog-supplies','pet-supplies','Pedigree',   '2309',5,  [2499,  3299],'pet',false,10.1],
  ['Drools Adult Active Dog Food Chicken&Egg 3kg',   'dog-supplies','pet-supplies','Drools',           '2309',5,  [1299,  1799],'pet',false,3.100],
  ['Whiskas Ocean Fish Adult Cat Food 1.2kg',        'cat-supplies','pet-supplies','Whiskas',          '2309',5,  [799,   1099],'pet',false,1.200],
  ['Me-O Tuna in Jelly Adult Cat Wet Food 80g x12',  'cat-supplies','pet-supplies','Me-O',            '2309',5,  [499,    799],'pet',false,0.960],
  // ── TOOLS ────────────────────────────────────────────────────────────────
  ['Bosch GSB 500W Professional Impact Drill Machine','power-tools','industrial','Bosch',             '8467',18, [2999,  4499],'tools',false,1.800],
  ['Stanley 16-Piece Hand Tool Kit with Carry Bag',  'hand-tools','industrial','Stanley',             '8205',18, [1299,  2199],'tools',false,1.200],
  ['Taparia 22-piece Combination Spanner Set',       'hand-tools','industrial','Taparia',             '8204',18,  [999,  1799],'tools',false,0.900],
  // ── MUSICAL INSTRUMENTS ──────────────────────────────────────────────────
  ['Yamaha F280 Acoustic Guitar Natural Finish',     'string-instruments','musical-instruments','Yamaha','9202',18,[7999, 11999],'guitar',false,2.000],
  ['Fender FA-125CE Dreadnought Acoustic-Electric',  'string-instruments','musical-instruments','Fender','9202',18,[14999, 19999],'guitar',false,2.200],
  ['Casio CT-S300 Electronic Keyboard 61 Keys',      'keyboard-piano','musical-instruments','Casio',  '9207',18, [3999,  5999],'piano',false,2.400],
  ['Yamaha YPT-270 61-Key Portable Keyboard',        'keyboard-piano','musical-instruments','Yamaha', '9207',18, [7999, 10999],'piano',false,3.800],
  // ── GARDEN & OUTDOORS ────────────────────────────────────────────────────
  ['Ugaoo Jade Plant — Good Luck Succulent Indoor',  'plants-pots','garden-outdoors','Ugaoo',         '0602',5,   [299,   599],'garden',false,0.500],
  ['Kraft Seeds Marigold Flower Seeds Packet 50pcs', 'plants-pots','garden-outdoors','Kraft Seeds',   '1209',5,    [49,    99],'garden',false,0.010],
  ['Bosmere Garden Trowel Stainless Steel Handle',   'gardening-tools','garden-outdoors','Bosmere',   '8201',18,  [399,   699],'garden',false,0.250],
  // ── BRIDAL / ETHNIC TRADITIONAL ──────────────────────────────────────────
  ['Manyavar Embroidered Silk Sherwani Bridal Set',  'bridal-wear','ethnic-traditional','Manyavar',   '6109',12, [8999, 24999],'bridal',false,1.000],
  ['Kalki Fashion Designer Bridal Lehenga Red',      'bridal-wear','ethnic-traditional','Kalki Fashion','6104',12,[14999, 49999],'bridal',false,1.500],
  ['Biba Navratri Special Chaniya Choli Set',        'festive-wear','ethnic-traditional','Biba',       '6104',5,  [1999,  3999],'ethnic',false,0.600],
  // ── OFFICE SUPPLIES ──────────────────────────────────────────────────────
  ['Luxor Pilot V5 Hi-Tecpoint Pen Blue 10pc Set',  'writing-tools','office-stationery','Pilot',      '9608',18,  [299,   449],'office',false,0.080],
  ['Classmate Unruled Long Book 140 Pages 6pc',     'office-supplies','office-stationery','Classmate','4820',18,  [199,   299],'office',false,0.420],
  ['Camlin Acrylic Colors 10 Shades 15ml Tubes',    'art-craft','office-stationery','Camlin',         '3212',18,  [299,   499],'art',false,0.200],
  ['Staedtler Mars Plastic Eraser 526B Box of 20',  'office-supplies','office-stationery','Staedtler','4016',18,  [249,   399],'office',false,0.060],
];

// ─── Execute ─────────────────────────────────────────────────────────────────
class ProductsSeed {
  constructor() {
    this.logger = new SeedLogger('Products');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`🛍️  Seeding Products — ${PRODUCT_TEMPLATES.length} templates → 10,000+ products across all categories`);

    await conn.collection('products').deleteMany({});

    // Load seller IDs
    const sellerDocs = await conn.collection('users').find({ role: 'SELLER' }, { projection: { _id: 1 } }).toArray();
    if (!sellerDocs.length) throw new Error('No sellers found — run sellers seed first');
    const sellerIds = sellerDocs.map(s => s._id.toString());

    // Build categoryKey → _id map (all levels)
    const catDocs = await conn.collection('categorytrees').find({}, { projection: { categoryKey: 1 } }).toArray();
    const catMap = {};
    catDocs.forEach(c => { catMap[c.categoryKey] = c._id; });

    // Load brand name → _id map
    const brandDocs = await conn.collection('brands').find({}, { projection: { name: 1, slug: 1 } }).toArray();
    const brandMap = {};
    brandDocs.forEach(b => { brandMap[(b.name || '').toLowerCase()] = b._id; brandMap[(b.slug || '').toLowerCase()] = b._id; });

    const now = new Date();
    const slugCounts = {};
    const skuSet    = new Set();
    const bcSet     = new Set();

    const genSKU = () => {
      let v; do { v = `SKU-${Math.random().toString(36).substring(2,10).toUpperCase()}`; } while (skuSet.has(v)); skuSet.add(v); return v;
    };
    const genBC = () => {
      let v; do { v = String(randNum(1000000000000,9999999999999)); } while (bcSet.has(v)); bcSet.add(v); return v;
    };
    const genSlug = (t) => {
      const base = slugify(t);
      slugCounts[base] = (slugCounts[base] || 0) + 1;
      return slugCounts[base] === 1 ? base : `${base}-${slugCounts[base]}`;
    };
    const getImgs = (key) => {
      const pool = IMG[key] || IMG.smartphone;
      return [rand(pool), rand(pool), rand(pool)].filter((v,i,a)=>a.indexOf(v)===i).concat([rand(pool),rand(pool)]).slice(0,3);
    };

    const SUFFIXES = ['Pro','Plus','Max','Lite','SE','Edition','Special Edition',
                      'Premium','Exclusive','New Arrival','2024','2025','Combo','Value Pack',
                      '(Renewed)','with Warranty','BIS Certified'];
    const STATUSES = ['active','active','active','active','active','active','active','draft','pending_approval','inactive'];

    const allDocs = [];
    const TARGET  = 10000;
    const loops   = Math.ceil(TARGET / PRODUCT_TEMPLATES.length);

    for (let loop = 0; loop < loops && allDocs.length < TARGET; loop++) {
      for (const [title, subcat, rootcat, brandName, hsnCode, gstRate, priceRange, imgKey, hasVariants, weightKg] of PRODUCT_TEMPLATES) {
        if (allDocs.length >= TARGET) break;

        const sellerId   = rand(sellerIds);
        const mrp        = randPrice(priceRange[0], priceRange[1]);
        const disct      = randNum(5, 45);
        const salePrice  = Math.round(mrp * (1 - disct / 100));
        const costPrice  = Math.round(salePrice * 0.65);
        const stock      = randNum(0, 500);
        const rating     = parseFloat((3.5 + Math.random() * 1.5).toFixed(1));
        const reviews    = randNum(0, 8000);
        const imgs       = getImgs(imgKey);
        const prodTitle  = loop === 0 ? title : `${title} — ${rand(SUFFIXES)}`;
        const slug       = genSlug(prodTitle);
        const sku        = genSKU();
        const barcode    = genBC();
        const status     = rand(STATUSES);
        const createdAt  = new Date(now.getTime() - randNum(0, 730) * 86400000);

        const taxClass = gstRate === 0  ? 'ZERO_RATED'
          : gstRate === 3  ? 'GST_3'
          : gstRate === 5  ? 'GST_5'
          : gstRate === 12 ? 'GST_12'
          : gstRate === 18 ? 'GST_18'
          : 'GST_28';

        allDocs.push({
          _id: new mongoose.Types.ObjectId(),
          sellerId,
          title: prodTitle,
          slug,
          sku,
          barcode,
          productType: hasVariants ? 'VARIABLE' : 'SIMPLE',
          visibility:  'public',
          status,
          price:           mrp,
          mrp,
          salePrice,
          costPrice,
          discountPercent: disct,
          categoryId:      catMap[subcat] || catMap[rootcat] || null,
          category:        subcat,
          parentCategory:  rootcat,
          brand:           brandName,
          brandSlug:       slugify(brandName),
          brandId:         brandMap[brandName.toLowerCase()] || null,
          hsnCode,
          gstRate,
          gstInclusive:    true,
          taxClass,
          stock,
          reservedStock:   Math.min(Math.floor(stock * 0.1), 20),
          reorderLevel:    10,
          hasVariants,
          variantAxes: hasVariants
            ? (imgKey === 'smartphone' || imgKey === 'laptop' ? ['color','storage'] : ['color','size'])
            : [],
          variants: [],
          weight:     { value: weightKg, unit: 'kg' },
          dimensions: { length: randNum(5,60), width: randNum(5,50), height: randNum(2,40), unit: 'cm' },
          volumetricWeight: parseFloat((weightKg * 1.2).toFixed(2)),
          images: { thumbnail: imgs[0], gallery: imgs },
          seo: {
            metaTitle:       `Buy ${title} Online at Best Price`,
            metaDescription: `Shop ${title} from ${brandName}. ✓ Free delivery ✓ Easy returns ✓ COD available at best price.`,
            keywords:        [title.split(' ').slice(0,3).join(' '), brandName, subcat, rootcat],
          },
          shipping: {
            freeShipping:   mrp >= 499,
            estimatedDays:  randNum(1, 7),
            shippingClass:  weightKg > 20 ? 'heavy' : weightKg > 3 ? 'standard' : 'light',
          },
          inventorySettings: { trackInventory: true, allowBackorders: false, lowStockThreshold: 10 },
          rating,
          reviewCount: reviews,
          ratingsBreakdown: {
            5: Math.round(reviews * 0.4),
            4: Math.round(reviews * 0.3),
            3: Math.round(reviews * 0.15),
            2: Math.round(reviews * 0.1),
            1: Math.round(reviews * 0.05),
          },
          wishlistCount: randNum(0, 3000),
          viewCount:     randNum(100, 200000),
          salesCount:    randNum(0, 80000),
          isPublished:   status === 'active',
          isFeatured:    Math.random() < 0.04,
          tags:    [],
          badges:  [],
          createdAt,
          updatedAt: new Date(),
        });
      }
    }

    const BATCH = 500;
    for (let i = 0; i < allDocs.length; i += BATCH) {
      await conn.collection('products').insertMany(allDocs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, allDocs.length - i));
    }

    this.logger.printStats();
    return { created: allDocs.length };
  }
}

module.exports = ProductsSeed;

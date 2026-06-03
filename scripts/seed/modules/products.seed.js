'use strict';

/**
 * Products Seed Module
 * Generates 10,000+ realistic Indian ecommerce products
 * Linked to categories, brands, sellers, HSN codes
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randPrice = (min, max) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

// Product templates: [title, category, subcategory, brand, hsnCode, gstRate, priceRange, images, hasVariants, weightKg]
const PRODUCT_TEMPLATES = [
  // SMARTPHONES
  ['Samsung Galaxy A54 5G 128GB','smartphones','electronics','Samsung','8517',18,[15999,24999],'electronics',true,0.2],
  ['OnePlus Nord CE 3 Lite 5G','smartphones','electronics','OnePlus','8517',18,[14999,19999],'electronics',true,0.18],
  ['Realme 11 Pro+ 5G 256GB','smartphones','electronics','Realme','8517',18,[19999,27999],'electronics',true,0.19],
  ['Apple iPhone 15 128GB','smartphones','electronics','Apple','8517',18,[69999,89999],'electronics',true,0.17],
  ['Apple iPhone 15 Pro 256GB','smartphones','electronics','Apple','8517',18,[134999,154999],'electronics',true,0.187],
  ['Xiaomi Redmi Note 13 Pro','smartphones','electronics','Xiaomi','8517',18,[17999,24999],'electronics',true,0.19],
  ['Motorola Edge 40 Neo','smartphones','electronics','Motorola','8517',18,[16999,22999],'electronics',true,0.17],
  ['Poco X6 Pro 5G 256GB','smartphones','electronics','Poco','8517',18,[22999,29999],'electronics',true,0.19],
  ['iQOO Z9 5G 8GB+256GB','smartphones','electronics','iQOO','8517',18,[21999,27999],'electronics',true,0.2],
  ['Google Pixel 8 Pro 256GB','smartphones','electronics','Google','8517',18,[89999,109999],'electronics',true,0.21],
  ['Nothing Phone 2a 256GB','smartphones','electronics','Nothing','8517',18,[24999,30999],'electronics',true,0.19],
  ['Samsung Galaxy S24 Ultra 512GB','smartphones','electronics','Samsung','8517',18,[129999,159999],'electronics',true,0.232],
  ['Tecno Spark 20 Pro 128GB','smartphones','electronics','Tecno','8517',18,[10999,14999],'electronics',true,0.18],
  ['Infinix Hot 40 Pro 128GB','smartphones','electronics','Infinix','8517',18,[10999,13999],'electronics',true,0.19],
  ['Lava Agni 2 5G 128GB','smartphones','electronics','Lava','8517',18,[13999,17999],'electronics',true,0.18],
  // LAPTOPS
  ['Dell XPS 15 Intel Core i7 512GB SSD','laptops','computers','Dell','8471',18,[99999,139999],'computers',true,1.86],
  ['HP Pavilion 15 AMD Ryzen 5 512GB','laptops','computers','HP','8471',18,[52999,69999],'computers',true,1.75],
  ['Lenovo IdeaPad Gaming 3 RTX 3060','laptops','computers','Lenovo','8471',18,[79999,99999],'computers',true,2.2],
  ['Asus ROG Strix G16 RTX 4060','laptops','computers','Asus','8471',18,[99999,129999],'computers',true,2.3],
  ['Acer Aspire 5 Intel Core i5','laptops','computers','Acer','8471',18,[44999,59999],'computers',true,1.8],
  ['Apple MacBook Air M2 256GB','laptops','computers','Apple','8471',18,[99900,119999],'computers',true,1.24],
  ['Apple MacBook Pro M3 512GB','laptops','computers','Apple','8471',18,[179999,219999],'computers',true,1.4],
  ['Microsoft Surface Laptop 5','laptops','computers','Microsoft','8471',18,[99999,139999],'computers',true,1.29],
  ['Avita Magus AMD Ryzen 5 512GB','laptops','computers','Avita','8471',18,[34999,44999],'computers',true,1.65],
  // TELEVISIONS
  ['Samsung 55 Inch 4K Smart TV','televisions','tv-audio','Samsung','8528',28,[49999,69999],'tv-audio',true,17.0],
  ['LG OLED C3 55 Inch 4K TV','televisions','tv-audio','LG','8528',28,[99999,139999],'tv-audio',true,16.5],
  ['Sony Bravia X75L 43 Inch 4K TV','televisions','tv-audio','Sony','8528',28,[42999,54999],'tv-audio',true,10.0],
  ['TCL C645 55 Inch QLED 4K TV','televisions','tv-audio','TCL','8528',28,[44999,59999],'tv-audio',true,14.0],
  ['OnePlus Y Series 32 Inch HD TV','televisions','tv-audio','OnePlus','8528',28,[13999,17999],'tv-audio',true,5.5],
  ['Vu 65 Inch 4K QLED TV','televisions','tv-audio','Vu','8528',28,[54999,74999],'tv-audio',true,22.0],
  ['Mi 55 Inch 4K Android TV','televisions','tv-audio','Mi','8528',28,[39999,54999],'tv-audio',true,14.0],
  ['Hisense 55 Inch 4K ULED TV','televisions','tv-audio','Hisense','8528',28,[44999,59999],'tv-audio',true,13.5],
  // AUDIO
  ['boAt Airdopes 141 TWS Earbuds','earphones','electronics','boAt','8518',18,[799,1299],'electronics',true,0.04],
  ['Sony WH-1000XM5 Noise Cancelling','earphones','electronics','Sony','8518',18,[24999,34999],'electronics',true,0.25],
  ['Apple AirPods Pro 2nd Gen','earphones','electronics','Apple','8518',18,[24900,29900],'electronics',true,0.054],
  ['Boat Rockerz 550 Wireless Headphone','earphones','electronics','boAt','8518',18,[1299,1999],'electronics',true,0.22],
  ['JBL Tune 760NC Wireless','earphones','electronics','JBL','8518',18,[3999,5999],'electronics',true,0.2],
  ['Noise Shots X5 Neo TWS Earbuds','earphones','electronics','Noise','8518',18,[899,1499],'electronics',true,0.035],
  ['Sennheiser Momentum 4 Wireless','earphones','electronics','Sennheiser','8518',18,[29999,39999],'electronics',true,0.293],
  ['Realme Buds Air 5 Pro TWS','earphones','electronics','Realme','8518',18,[2999,4499],'electronics',true,0.04],
  // SMARTWATCHES
  ['Apple Watch Series 9 GPS 45mm','smartwatches','electronics','Apple','9102',18,[41900,49900],'electronics',true,0.038],
  ['Samsung Galaxy Watch 6 44mm','smartwatches','electronics','Samsung','9102',18,[26999,34999],'electronics',true,0.033],
  ['boAt Storm Call 3 Smartwatch','smartwatches','electronics','boAt','9102',18,[1499,2499],'electronics',true,0.045],
  ['Fire-Boltt Phoenix Ultra Smartwatch','smartwatches','electronics','Fire-Boltt','9102',18,[1799,2799],'electronics',true,0.045],
  ['Garmin Forerunner 265S GPS Watch','smartwatches','electronics','Garmin','9102',18,[39999,54999],'electronics',true,0.039],
  ['Noise ColorFit Pro 5 Max','smartwatches','electronics','Noise','9102',18,[2999,4499],'electronics',true,0.042],
  ['Amazfit GTR 4 Smartwatch','smartwatches','electronics','Amazfit','9102',18,[11999,16999],'electronics',true,0.034],
  // MEN'S FASHION
  ["Manyavar Men's Silk Kurta Set",'mens-ethnic','mens-fashion','Manyavar','6109',12,[2999,7999],'fashion',true,0.4],
  ["Allen Solly Men's Formal Shirt",'mens-shirts','mens-fashion','Allen Solly','6205',5,[799,1299],'fashion',true,0.2],
  ["Levi's 511 Slim Fit Jeans",'mens-jeans','mens-fashion',"Levi's",'6203',12,[2499,3999],'fashion',true,0.6],
  ["HM Men's Oversized Graphic T-Shirt",'mens-tshirts','mens-fashion','H&M','6109',5,[799,1299],'fashion',true,0.2],
  ["US Polo Assn Men's Polo T-Shirt",'mens-tshirts','mens-fashion','US Polo Assn','6109',5,[799,1499],'fashion',true,0.22],
  ["Jack & Jones Men's Casual Jacket",'mens-jackets','mens-fashion','Jack & Jones','6201',12,[1999,3999],'fashion',true,0.5],
  ["Pepe Jeans Men's Chino Trousers",'mens-jeans','mens-fashion','Pepe Jeans','6203',12,[1499,2499],'fashion',true,0.45],
  ["Van Heusen Men's Slim Fit Formal Shirt",'mens-suits','mens-fashion','Van Heusen','6205',5,[999,1799],'fashion',true,0.22],
  ["Being Human Men's Trackpant",'mens-activewear','mens-fashion','Being Human','6109',5,[699,1299],'fashion',true,0.3],
  ["Roadster Men's Regular Fit T-Shirt",'mens-tshirts','mens-fashion','Roadster','6109',5,[499,899],'fashion',true,0.2],
  // WOMEN'S FASHION
  ["W Women's A-Line Kurta",'kurtas-suits','womens-fashion','W','6104',5,[799,1499],'fashion',true,0.3],
  ["Biba Women's Cotton Anarkali",'kurtas-suits','womens-fashion','Biba','6104',5,[1299,2999],'fashion',true,0.4],
  ["Levi's Women's 710 Skinny Jeans",'womens-bottoms','womens-fashion',"Levi's",'6204',12,[1799,2999],'fashion',true,0.55],
  ["Global Desi Women's Casual Top",'western-tops','womens-fashion','Global Desi','6106',5,[499,999],'fashion',true,0.18],
  ["H&M Women's Maxi Dress",'dresses','womens-fashion','H&M','6204',12,[1499,2499],'fashion',true,0.35],
  ['Saree Mall Banarasi Silk Saree','sarees','womens-fashion','Raymond','5007',5,[2999,8999],'fashion',true,0.5],
  ["AND Women's Wrap Dress",'dresses','womens-fashion','AND','6204',12,[1499,2999],'fashion',true,0.32],
  ["Aurelia Women's Printed Kurta",'kurtas-suits','womens-fashion','Aurelia','6104',5,[799,1799],'fashion',true,0.3],
  ["Mango Women's Blazer",'womens-bottoms','womens-fashion','Mango','6204',12,[2999,5999],'fashion',true,0.35],
  ["Only Women's High Rise Jeans",'womens-bottoms','womens-fashion','ONLY','6204',12,[1499,2499],'fashion',true,0.55],
  // FOOTWEAR
  ["Nike Air Max 270 Running Shoes",'mens-shoes','footwear','Nike','6403',18,[7999,12999],'footwear',true,0.32],
  ["Adidas Ultraboost 22 Men's",'sports-outdoor-shoes','footwear','Adidas','6403',18,[8999,14999],'footwear',true,0.33],
  ["Bata Men's Oxford Formal Shoes",'mens-shoes','footwear','Bata','6403',18,[1499,2999],'footwear',true,0.4],
  ["Skechers Women's Running Shoes",'womens-shoes','footwear','Skechers','6404',18,[3499,5499],'footwear',true,0.29],
  ["Campus Women's Sports Shoes",'sports-outdoor-shoes','footwear','Campus','6404',12,[1299,2499],'footwear',true,0.28],
  ["Metro Women's Block Heels",'womens-shoes','footwear','Metro Shoes','6403',18,[1499,2999],'footwear',true,0.45],
  ["Paragon Men's Hawai Slippers",'slippers','footwear','Paragon','6404',12,[199,399],'footwear',true,0.2],
  ["Crocs Classic Clog",'slippers','footwear','Crocs','6402',18,[2299,3999],'footwear',true,0.3],
  ["Woodland Men's Leather Casual Shoes",'mens-shoes','footwear','Woodland','6403',18,[2999,5499],'footwear',true,0.42],
  ["Puma Men's Ferrari Sneakers",'mens-shoes','footwear','Puma','6403',18,[3499,5499],'footwear',true,0.3],
  // BEAUTY
  ["Lakme 9to5 Foundation SPF 25 Medium",'makeup','beauty','Lakme','3304',18,[549,799],'beauty',true,0.08],
  ["Maybelline Fit Me Matte Foundation",'makeup','beauty','Maybelline','3304',18,[399,699],'beauty',true,0.1],
  ["L'Oreal Paris Revitalift Face Serum",'skincare','beauty',"L'Oreal Paris",'3304',18,[699,999],'beauty',false,0.04],
  ["Mamaearth Vitamin C Face Wash 100ml",'skincare','beauty','Mamaearth','3306',18,[249,349],'beauty',true,0.12],
  ["Minimalist 2% Salicylic Acid Serum",'skincare','beauty','Minimalist','3304',18,[599,849],'beauty',true,0.07],
  ["WOW Skin Science Biotin Shampoo",'haircare','beauty','WOW Skin Science','3305',18,[449,649],'beauty',true,0.3],
  ["Plum Green Tea Pore Cleansing Face Wash",'skincare','beauty','Plum','3306',18,[299,449],'beauty',true,0.1],
  ["The Derma Co 10% Niacinamide Serum",'skincare','beauty','The Derma Co','3304',18,[699,999],'beauty',true,0.03],
  ["Forest Essentials Ayurvedic Face Cream",'skincare','beauty','Forest Essentials','3304',18,[899,2499],'beauty',false,0.06],
  ["Nykaa Cosmetics RESET Kajal Eye Pencil",'makeup','beauty','Nykaa Cosmetics','3304',18,[199,399],'beauty',true,0.015],
  ["Charlotte Tilbury Pillow Talk Lipstick",'makeup','beauty','Charlotte Tilbury','3304',18,[3499,4999],'beauty',true,0.017],
  ["Sugar Cosmetics Nothing Else Matter Foundation",'makeup','beauty','Sugar Cosmetics','3304',18,[799,999],'beauty',true,0.08],
  ["Dove Body Lotion Intensive Care 250ml",'bodycare','beauty','Dove','3304',18,[249,349],'beauty',true,0.27],
  ["Biotique Bio Papaya Scrub",'skincare','beauty','Biotique','3304',18,[199,299],'beauty',false,0.075],
  ["Himalaya Moisturising Face Cream 100ml",'skincare','beauty','Himalaya','3304',18,[149,249],'beauty',false,0.11],
  // APPLIANCES
  ['Samsung 7.5 kg Front Load Washing Machine','washing-machines','appliances','Samsung','8450',18,[35999,49999],'appliances',false,65.0],
  ['LG 8 kg Top Load Washing Machine','washing-machines','appliances','LG','8450',18,[28999,38999],'appliances',false,50.0],
  ['Whirlpool 260 Litre Double Door Fridge','refrigerators','appliances','Whirlpool','8418',18,[22999,29999],'appliances',true,55.0],
  ['Samsung 1.5 Ton 5 Star Inverter AC','air-conditioners','appliances','Samsung','8415',28,[32999,44999],'appliances',false,12.5],
  ['LG 1 Ton 5 Star Dual Inverter Split AC','air-conditioners','appliances','LG','8415',28,[27999,37999],'appliances',false,10.8],
  ['IFB 25 L Convection Microwave','microwave-ovens','appliances','IFB','9009',28,[8999,13999],'appliances',true,14.0],
  ['Voltas Vertis Premium 1.5T Window AC','air-conditioners','appliances','Voltas','8415',28,[24999,34999],'appliances',false,38.5],
  ['Havells Trimmer Ultra ES Fan 1200mm','fans-coolers','appliances','Havells','8414',18,[2499,3999],'appliances',true,2.5],
  ['Atomberg Studio 1200mm BLDC Fan','fans-coolers','appliances','Atomberg','8414',18,[2999,4499],'appliances',true,2.8],
  ['Prestige 5 Litre Pressure Cooker','small-appliances','home-kitchen','Prestige','7323',12,[1299,1999],'home-kitchen',false,1.8],
  ['Pigeon Favourite Mixer Grinder 750W','small-appliances','appliances','Pigeon','8509',28,[1899,2999],'appliances',false,3.0],
  ['Butterfly Smart Mixer Grinder 2L','small-appliances','appliances','Butterfly','8509',28,[1799,2799],'appliances',false,2.8],
  ['Bajaj Electricals 1.5L Electric Kettle','small-appliances','appliances','Bajaj Electricals','8516',28,[699,1199],'appliances',false,0.75],
  ['Faber 90cm 1500m3/hr Hood Chimney','kitchen-chimneys','appliances','Faber','8415',18,[8999,14999],'appliances',false,8.0],
  ['Racold Primus 15L Water Heater','geysers','appliances','Racold','8516',28,[5499,8999],'appliances',false,9.5],
  // HOME & KITCHEN
  ['Hawkins Contura 5L Pressure Cooker','cookware','home-kitchen','Hawkins','7323',12,[1999,2999],'home-kitchen',false,2.1],
  ['Cello Opalware Dinner Set 27 Pcs','tableware','home-kitchen','Nilkamal','6911',12,[1499,2499],'home-kitchen',false,3.5],
  ['Solimo 5 Litre Water Bottle','kitchen-storage','home-kitchen','Solimo','3923',18,[399,699],'home-kitchen',true,0.28],
  ['Story@Home 300 TC King Size Bedsheet','home-textiles','home-kitchen','Story@Home','6302',5,[799,1499],'home-kitchen',true,0.9],
  ['SPACES Story Cotton Bath Towel','home-textiles','home-kitchen','SPACES','6302',5,[299,599],'home-kitchen',true,0.35],
  ['Ikea KOMPLEMENT Storage Box','home-decor','home-kitchen','IKEA','4819',18,[799,1599],'home-kitchen',true,0.8],
  ['CTR Doodle Wireless LED Wall Clock','home-decor','home-kitchen','CTR','9105',18,[499,999],'home-kitchen',true,0.4],
  // FURNITURE
  ['Wakefit Orthopedic Queen Size Mattress','bedroom-furniture','furniture','Wakefit','9404',18,[8999,14999],'furniture',true,22.0],
  ['Sleepwell Nexa Foam Queen Mattress','bedroom-furniture','furniture','Sleepwell','9404',18,[9999,17999],'furniture',false,24.0],
  ['Nilkamal Chester 3-Seater Sofa Set','living-room-furniture','furniture','Nilkamal','9401',28,[12999,19999],'furniture',true,48.0],
  ['Royal Oak Torino L-Shape Sofa','living-room-furniture','furniture','Royal Oak','9401',28,[17999,27999],'furniture',true,65.0],
  ['Durian Ethan 3+2 Seater Sofa Set','living-room-furniture','furniture','Durian','9401',28,[24999,44999],'furniture',true,75.0],
  ['Godrej Interio Slimline 4-Door Wardrobe','bedroom-furniture','furniture','Godrej Interio','9403',28,[18999,29999],'furniture',true,80.0],
  ['Spacewood Optima Study Table 4 ft','office-study-furniture','furniture','Royal Oak','9403',28,[3999,6999],'furniture',true,15.0],
  ['Green Soul Athens High-Back Ergonomic Chair','office-study-furniture','furniture','Green Soul','9401',28,[8999,15999],'furniture',true,14.0],
  // SPORTS
  ["SG Century Plus English Willow Cricket Bat",'cricket','sports','SG Cricket','9506',18,[2999,5499],'sports',false,1.2],
  ["Yonex ZR 100 Aluminium Badminton Racket",'badminton','sports','Yonex','9506',18,[599,999],'sports',false,0.09],
  ["Nike H2867 Men's Football",'football','sports','Nike','9506',18,[799,1299],'sports',false,0.42],
  ["Cosco X-Force Volleyball",'football','sports','Cosco','9506',18,[699,1199],'sports',false,0.28],
  ["Nivia Running Shoes",'sports-outdoor-shoes','sports','Nivia','6403',18,[699,1299],'footwear',true,0.28],
  ["Li-Ning Badminton Racket G-Tek 68","badminton",'sports','Li-Ning','9506',18,[699,999],'sports',false,0.085],
  ["Strauss Yoga Mat 6mm",'yoga','sports','Strauss','9506',18,[499,899],'sports',true,0.85],
  ["Nivia Storm Synthetic Leather Football",'football','sports','Nivia','9506',18,[699,1199],'sports',false,0.43],
  ["SleevesUp Neoprene Knee Support",'gym-fitness','sports','SleevesUp','9021',5,[499,999],'sports',true,0.08],
  // TOYS & BABY
  ['LEGO Classic Large Creative Brick Box','educational-toys','toys','LEGO','9503',12,[3999,6999],'toys',false,1.15],
  ['Hot Wheels 20 Car Gift Pack','action-figures','toys','Hot Wheels','9503',12,[699,1199],'toys',false,0.35],
  ['Barbie Dreamhouse 3-Story Doll House','dolls','toys','Barbie','9503',12,[7999,12999],'toys',false,4.5],
  ['Funskool Monopoly Board Game','educational-toys','toys','Funskool','9504',12,[599,999],'toys',false,0.62],
  ['LuvLap Sunshine Baby Stroller','baby-products','toys','LuvLap','8715',18,[4999,8999],'toys',true,5.2],
  ['Mee Mee Wide-Neck Feeding Bottle 250ml','baby-products','toys','Mee Mee','3923',18,[299,499],'toys',true,0.09],
  ['R for Rabbit Hokey Pokey Baby Walker','outdoor-play','toys','R for Rabbit','9501',12,[2499,3999],'toys',true,4.5],
  ['Chhota Bheem Radio Controlled Car','action-figures','toys','Chhota Bheem','9503',12,[499,899],'toys',true,0.35],
  // AUTOMOTIVE
  ["Bosch S6 Car Battery 65AH",'tyres-batteries','automotive','Bosch Automotive','8507',18,[7499,9999],'automotive',false,18.5],
  ["Ceat Milaze X3 185/65 R15 Tyre",'tyres-batteries','automotive','Ceat','4011',28,[4499,5999],'automotive',false,8.2],
  ["Viken Dash Cam 4K WiFi",'car-electronics','automotive','Viken','8525',18,[2999,4999],'automotive',false,0.12],
  ["GROGLASS Car Seat Cover Leatherite Set",'car-accessories','automotive','GROGLASS','8708',18,[1999,3499],'automotive',false,3.5],
  ["Castrol Magnatec 5W-40 4L Engine Oil",'oils-fluids','automotive','Castrol','2710',18,[1399,1799],'automotive',false,3.6],
  ['Steelbird SBA-3 Matt Black Full Face Helmet','bike-accessories','automotive','Steelbird','6506',18,[1499,2499],'automotive',true,1.2],
  // JEWELRY
  ['Tanishq Gold Necklace 22K 10g','gold-jewelry','jewelry','Tanishq','7113',3,[50000,80000],'jewelry',false,0.015],
  ['Bluestone Diamond Solitaire Ring 0.20ct','diamond-jewelry','jewelry','Bluestone','7113',3,[25000,45000],'jewelry',true,0.003],
  ['Caratlane Daily Wear Silver Earrings Set','silver-jewelry','jewelry','Caratlane','7113',3,[999,2499],'jewelry',true,0.006],
  ['Voylla Floral Kundan Jhumka Earrings','fashion-jewelry','jewelry','Voylla','7117',3,[399,899],'jewelry',true,0.025],
  // WATCHES
  ['Titan Raga Women Analog Watch','womens-watches','watches','Titan','9102',18,[3499,5999],'watches',true,0.065],
  ['Fastrack Men Analog Chronograph Watch','mens-watches','watches','Fastrack','9102',18,[2499,4499],'watches',true,0.075],
  ['Casio G-Shock GA-2100 Analog-Digital','mens-watches','watches','Casio','9102',18,[9999,14999],'watches',true,0.085],
  ['Sonata Ocean Series Men Watch','mens-watches','watches','Sonata','9102',18,[899,1499],'watches',true,0.055],
  // BAGS & LUGGAGE
  ['Samsonite Starvibe 55cm Cabin Trolley','luggage','bags-luggage','Samsonite','4202',28,[9999,14999],'bags-luggage',true,2.6],
  ['American Tourister Linex 24cm Suitcase','luggage','bags-luggage','American Tourister','4202',28,[4999,7999],'bags-luggage',true,3.2],
  ['VIP Polo Check-in Hardcase 28"','luggage','bags-luggage','VIP Industries','4202',28,[4499,7499],'bags-luggage',true,3.6],
  ['Lavie Women Tote Bag','handbags','bags-luggage','Lavie','4202',28,[1299,2499],'bags-luggage',true,0.45],
  ['Wildcraft 45L Trekking Backpack','backpacks','bags-luggage','Wildcraft','4202',28,[1999,3499],'bags-luggage',true,0.75],
  ['Safari 15.6 inch Laptop Backpack','backpacks','bags-luggage','Safari','4202',28,[999,1799],'bags-luggage',true,0.6],
  // FOOD
  ['Amul Taaza Full Cream Milk 5L','dairy-products','food-beverages','Amul','0401',0,[275,299],'food',false,5.0],
  ['Haldirams Aloo Bhujia 400g','snacks-namkeen','food-beverages','Haldirams','2106',5,[199,249],'food',false,0.42],
  ['Nescafe Classic Instant Coffee 200g','beverages','food-beverages','Nestle','0902',5,[599,699],'food',false,0.22],
  ["Lay's Magic Masala Chips 150g",'snacks-namkeen','food-beverages',"Lay's",'1905',5,[30,50],'food',false,0.155],
  ['Cadbury Dairy Milk Silk Box 330g','chocolate-sweets','food-beverages',"Cadbury's",'1806',18,[399,499],'food',true,0.34],
  ['MDH Rajma Masala 500g','condiments-spices','food-beverages','MDH Masala','0910',0,[175,225],'food',false,0.52],
  ['Patanjali Ghee 1L','dairy-products','food-beverages','Patanjali','0405',12,[499,599],'food',false,0.93],
  ['Basmati Rice Premium 5kg','food-basic','food-beverages','Amul','1006',0,[499,699],'food',false,5.05],
  ['Aashirvaad Whole Wheat Atta 10kg','food-basic','food-beverages','Aashirvaad','1101',0,[459,549],'food',false,10.1],
  ['Britannia Chocolate Cake 250g','snacks-namkeen','food-beverages','Britannia','1905',12,[99,149],'food',false,0.26],
  // BOOKS
  ['Atomic Habits by James Clear','fiction-literature','books','Harper Collins','4901',0,[299,499],'books',false,0.28],
  ['The Alchemist by Paulo Coelho','fiction-literature','books','Harper Collins','4901',0,[199,349],'books',false,0.24],
  ['Rich Dad Poor Dad - Robert Kiyosaki','non-fiction','books','Manjul Publishing','4901',0,[299,399],'books',false,0.29],
  ['CBSE Class 10 Science Textbook','academic-books','books','NCERT','4901',0,[99,199],'books',false,0.45],
  ['Wings of Fire - A.P.J. Abdul Kalam','non-fiction','books','Universities Press','4901',0,[149,249],'books',false,0.27],
  // HEALTH & WELLNESS
  ['MuscleBlaze Whey Protein 2kg Chocolate','vitamins-supplements','health-wellness','MuscleBlaze','2106',18,[2999,3999],'food',true,2.1],
  ['Oziva Protein & Herbs for Women 500g','vitamins-supplements','health-wellness','Oziva','2106',18,[1299,1799],'food',true,0.55],
  ['Himalaya Ashvagandha Tablets 60s','ayurveda','health-wellness','Himalaya','3004',5,[199,299],'health',false,0.065],
  ['Omron HEM-7120 BP Monitor','medical-devices','health-wellness','Omron','9025',12,[1799,2499],'electronics',false,0.35],
  ['Dr. Morepen BG-03 Glucometer','medical-devices','health-wellness','Dr. Morepen','9022',12,[899,1299],'electronics',false,0.08],
  ['Strauss Yoga Mat 6mm Extra Thick','fitness-equipment','health-wellness','Strauss','9506',18,[599,999],'sports',true,0.9],
  // GAMING
  ['PlayStation 5 Console 825GB','consoles','gaming','Sony','9504',28,[49999,54999],'electronics',false,4.5],
  ['Xbox Series X 1TB Console','consoles','gaming','Microsoft','9504',28,[49999,54999],'electronics',false,4.45],
  ['Nintendo Switch OLED Model','consoles','gaming','Nintendo','9504',28,[32999,36999],'electronics',true,0.32],
  ['Razer DeathAdder V3 Gaming Mouse','pc-gaming','gaming','Razer','8471',18,[5499,7999],'electronics',true,0.059],
  ['Asus ROG Strix Scope RX Mechanical Keyboard','pc-gaming','gaming','Asus','8471',18,[7999,12999],'electronics',true,1.1],
  ['Green Soul Ocean Gaming Chair','pc-gaming','gaming','Green Soul','9401',28,[8999,15999],'furniture',true,14.5],
  // PET SUPPLIES
  ['Royal Canin Adult Large Breed Dog Food 15kg','dog-supplies','pet-supplies','Royal Canin','2309',5,[5499,7499],'food',false,15.1],
  ['Pedigree Adult Chicken Dog Food 10kg','dog-supplies','pet-supplies','Pedigree','2309',5,[2499,3299],'food',false,10.1],
  ['Whiskas Tuna Kitten Cat Food 480g','cat-supplies','pet-supplies','Whiskas','2309',5,[399,549],'food',false,0.49],
  ['Drools Adult 3kg Cat Food','cat-supplies','pet-supplies','Drools','2309',5,[799,999],'food',false,3.05],
];

class ProductsSeed {
  constructor() {
    this.logger = new SeedLogger('Products');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`🛍️  Seeding Products — ${PRODUCT_TEMPLATES.length} templates → 10,000+ products`);

    await conn.collection('products').deleteMany({});

    // Load seller IDs
    const sellerDocs = await conn.collection('users').find({ role: 'SELLER' }, { projection: { _id: 1 } }).toArray();
    if (!sellerDocs.length) throw new Error('No sellers found — run sellers seed first');
    const sellerIds = sellerDocs.map(s => s._id.toString());

    // Load category keys
    const catDocs = await conn.collection('categorytrees').find({ level: 1 }, { projection: { categoryKey: 1, title: 1 } }).toArray();
    const catMap = {};
    catDocs.forEach(c => { catMap[c.categoryKey] = c._id.toString(); });

    // Load HSN codes
    const hsnDocs = await conn.collection('hsncodes').find({}, { projection: { code: 1, gstRate: 1 } }).toArray();
    const hsnMap = {};
    hsnDocs.forEach(h => { hsnMap[h.code] = h; });

    const now = new Date();
    const slugCounts = {};
    const skuSet = new Set();
    const barcodeSet = new Set();

    const genSKU = () => {
      let sku;
      do {
        sku = `SKU-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      } while (skuSet.has(sku));
      skuSet.add(sku);
      return sku;
    };

    const genBarcode = () => {
      let bc;
      do {
        bc = String(randNum(1000000000000, 9999999999999));
      } while (barcodeSet.has(bc));
      barcodeSet.add(bc);
      return bc;
    };

    const genSlug = (title) => {
      const base = slugify(title);
      slugCounts[base] = (slugCounts[base] || 0) + 1;
      return slugCounts[base] === 1 ? base : `${base}-${slugCounts[base]}`;
    };

    // Category-based image pools
    const IMG_POOLS = {
      electronics: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800','https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800','https://images.unsplash.com/photo-1491933382434-500287f9b54b?w=800','https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800'],
      computers: ['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800','https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800','https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800'],
      'tv-audio': ['https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=800','https://images.unsplash.com/photo-1545454675-3531b543be5d?w=800'],
      fashion: ['https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800','https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800','https://images.unsplash.com/photo-1527719327859-c6ce80353573?w=800','https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800'],
      footwear: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800','https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800','https://images.unsplash.com/photo-1460353581641-37baddab0fa2?w=800'],
      beauty: ['https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800','https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800','https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=800'],
      appliances: ['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800','https://images.unsplash.com/photo-1584568694244-14fbdf83bd30?w=800'],
      furniture: ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800','https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800'],
      food: ['https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800','https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800'],
      sports: ['https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=800','https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800'],
      toys: ['https://images.unsplash.com/photo-1558060370-d644485927b8?w=800'],
      'home-kitchen': ['https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800'],
      jewelry: ['https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800'],
      'bags-luggage': ['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=800'],
      books: ['https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800'],
      automotive: ['https://images.unsplash.com/photo-1543269865-cbf427effbad?w=800'],
    };

    const getImgs = (cat) => {
      const pool = IMG_POOLS[cat] || IMG_POOLS['electronics'];
      return [rand(pool), rand(pool), rand(pool)];
    };

    // Status distribution
    const STATUSES = ['ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','ACTIVE','DRAFT','SUBMITTED','INACTIVE'];

    const allDocs = [];
    const targetCount = 10000;
    const loopsNeeded = Math.ceil(targetCount / PRODUCT_TEMPLATES.length);

    for (let loop = 0; loop < loopsNeeded && allDocs.length < targetCount; loop++) {
      for (const [title, subcat, rootcat, brandName, hsnCode, gstRate, priceRange, imgCat, hasVariants, weightKg] of PRODUCT_TEMPLATES) {
        if (allDocs.length >= targetCount) break;

        const sellerId = rand(sellerIds);
        const mrp = randPrice(priceRange[0], priceRange[1]);
        const discountPct = randNum(5, 45);
        const salePrice = Math.round(mrp * (1 - discountPct / 100));
        const costPrice = Math.round(salePrice * 0.65);
        const stock = randNum(0, 500);
        const rating = parseFloat((3.5 + Math.random() * 1.5).toFixed(1));
        const reviewCount = randNum(0, 5000);
        const imgs = getImgs(imgCat);
        const productTitle = loop === 0 ? title : `${title} ${['Pro','Plus','Max','Lite','Edition','Version',String(randNum(2020, 2024))][randNum(0, 6)]}`;
        const slug = genSlug(productTitle);
        const sku = genSKU();
        const barcode = genBarcode();
        const status = rand(STATUSES);
        const createdAt = new Date(now.getTime() - randNum(0, 730) * 86400000);

        allDocs.push({
          _id: new mongoose.Types.ObjectId(),
          sellerId,
          title: productTitle,
          slug,
          sku,
          barcode,
          productType: hasVariants ? 'VARIABLE' : 'SIMPLE',
          visibility: 'PUBLIC',
          status,
          price: mrp,
          mrp,
          salePrice,
          costPrice,
          discountPercent: discountPct,
          categoryId: catMap[subcat] || catMap[rootcat] || null,
          category: subcat,
          parentCategory: rootcat,
          brand: brandName,
          brandSlug: slugify(brandName),
          hsnCode,
          gstRate,
          taxClass: gstRate === 0 ? 'ZERO_RATED' : gstRate === 3 ? 'GST_3' : gstRate === 5 ? 'GST_5' : gstRate === 12 ? 'GST_12' : gstRate === 18 ? 'GST_18' : 'GST_28',
          stock,
          reservedStock: Math.min(Math.floor(stock * 0.1), 20),
          reorderLevel: 10,
          hasVariants,
          variantAxes: hasVariants ? (imgCat === 'electronics' ? ['color','storage'] : ['color','size']) : [],
          variants: [],
          weight: { value: weightKg, unit: 'kg' },
          dimensions: { length: randNum(5, 60), width: randNum(5, 50), height: randNum(2, 40), unit: 'cm' },
          volumetricWeight: parseFloat((weightKg * 1.2).toFixed(2)),
          images: {
            thumbnail: imgs[0],
            gallery: imgs,
          },
          seo: {
            metaTitle: `${productTitle} — Buy Online at Best Price`,
            metaDescription: `Shop ${productTitle} from ${brandName}. Free delivery, easy returns, COD available.`,
            keywords: [productTitle.split(' ').slice(0, 3).join(' '), brandName, subcat],
          },
          shipping: {
            freeShipping: mrp >= 499,
            estimatedDays: randNum(1, 7),
            shippingClass: weightKg > 10 ? 'heavy' : weightKg > 3 ? 'standard' : 'light',
          },
          inventorySettings: {
            trackInventory: true,
            allowBackorders: false,
            lowStockThreshold: 10,
          },
          rating,
          reviewCount,
          ratingsBreakdown: {
            5: Math.round(reviewCount * 0.4),
            4: Math.round(reviewCount * 0.3),
            3: Math.round(reviewCount * 0.15),
            2: Math.round(reviewCount * 0.1),
            1: Math.round(reviewCount * 0.05),
          },
          wishlistCount: randNum(0, 2000),
          viewCount: randNum(100, 100000),
          salesCount: randNum(0, 50000),
          isPublished: status === 'ACTIVE',
          isFeatured: Math.random() < 0.05,
          tags: [],
          badges: [],
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

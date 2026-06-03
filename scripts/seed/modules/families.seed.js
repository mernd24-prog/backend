'use strict';

/**
 * Families Seed Module
 * Populates ProductFamily (productfamilies collection)
 * 300+ product families mapping categories to variant structures
 */

const mongoose = require('mongoose');
const SeedLogger = require('../utils/seed-logger');

// [familyCode, title, category, variantAxes, baseAttributes]
const FAMILIES = [
  // ── SMARTPHONES ──────────────────────────────────────────────────────────
  ['FAMILY-SMARTPHONE-ANDROID', 'Android Smartphone', 'smartphones', ['color', 'storage', 'ram'], { network: '5G', os: 'Android 14', connectivity: '5G,Wi-Fi,Bluetooth,NFC' }],
  ['FAMILY-SMARTPHONE-IPHONE', 'Apple iPhone', 'smartphones', ['color', 'storage'], { network: '5G', os: 'iOS 17', connectivity: '5G,Wi-Fi,Bluetooth,NFC' }],
  ['FAMILY-SMARTPHONE-BUDGET', 'Budget Smartphone', 'smartphones', ['color', 'storage', 'ram'], { network: '4G LTE', os: 'Android 13' }],
  ['FAMILY-SMARTPHONE-GAMING', 'Gaming Phone', 'smartphones', ['color', 'storage', 'ram'], { network: '5G', connectivity: 'USB-C,NFC' }],
  ['FAMILY-FEATUREPHONE', 'Feature Phone', 'feature-phones', ['color'], {}],
  // ── TABLETS ──────────────────────────────────────────────────────────────
  ['FAMILY-TABLET-ANDROID', 'Android Tablet', 'tablets', ['color', 'storage', 'ram'], { os: 'Android 13', connectivity: 'Wi-Fi,Bluetooth' }],
  ['FAMILY-TABLET-IPAD', 'Apple iPad', 'tablets', ['color', 'storage'], { os: 'iPadOS', connectivity: 'Wi-Fi,Bluetooth' }],
  ['FAMILY-TABLET-DRAWING', 'Drawing / Graphics Tablet', 'tablets', ['color'], {}],
  // ── LAPTOPS ──────────────────────────────────────────────────────────────
  ['FAMILY-LAPTOP-GAMING', 'Gaming Laptop', 'laptops', ['color', 'storage', 'ram'], { os: 'Windows 11', refresh_rate: '144Hz' }],
  ['FAMILY-LAPTOP-ULTRABOOK', 'Ultrabook / Thin & Light', 'laptops', ['color', 'storage', 'ram'], { os: 'Windows 11' }],
  ['FAMILY-LAPTOP-MACBOOK', 'MacBook', 'laptops', ['color', 'storage', 'ram'], { os: 'macOS Sonoma' }],
  ['FAMILY-LAPTOP-BUSINESS', 'Business Laptop', 'laptops', ['color', 'storage', 'ram'], { os: 'Windows 11' }],
  ['FAMILY-LAPTOP-CHROMEBOOK', 'Chromebook', 'laptops', ['color', 'storage'], { os: 'Chrome OS' }],
  // ── AUDIO ─────────────────────────────────────────────────────────────────
  ['FAMILY-TWS-EARBUDS', 'True Wireless (TWS) Earbuds', 'earphones', ['color'], { connectivity: 'Bluetooth' }],
  ['FAMILY-NECKBAND', 'Neckband Earphones', 'earphones', ['color'], { connectivity: 'Bluetooth' }],
  ['FAMILY-WIRED-EARPHONES', 'Wired Earphones', 'earphones', ['color'], { connectivity: 'USB-C' }],
  ['FAMILY-OVER-EAR-HEADPHONES', 'Over-Ear Headphones', 'earphones', ['color'], { connectivity: 'Bluetooth' }],
  ['FAMILY-GAMING-HEADSET', 'Gaming Headset', 'earphones', ['color'], { connectivity: 'USB-C,3.5mm' }],
  ['FAMILY-BT-SPEAKER', 'Portable Bluetooth Speaker', 'portable-speakers', ['color'], { connectivity: 'Bluetooth' }],
  ['FAMILY-PARTY-SPEAKER', 'Party Speaker', 'portable-speakers', ['color'], {}],
  // ── TV & VIDEO ────────────────────────────────────────────────────────────
  ['FAMILY-LED-TV', 'LED Smart TV', 'televisions', ['screen-size'], { resolution: '4K (3840x2160)', os: 'Android TV' }],
  ['FAMILY-OLED-TV', 'OLED TV', 'televisions', ['screen-size'], { resolution: '4K (3840x2160)' }],
  ['FAMILY-QLED-TV', 'QLED TV', 'televisions', ['screen-size'], { resolution: '4K (3840x2160)' }],
  // ── WEARABLES ─────────────────────────────────────────────────────────────
  ['FAMILY-SMARTWATCH-ANDROID', 'Android Smartwatch', 'smartwatches', ['color'], { connectivity: 'Bluetooth,Wi-Fi' }],
  ['FAMILY-SMARTWATCH-APPLE', 'Apple Watch', 'smartwatches', ['color'], { os: 'watchOS' }],
  ['FAMILY-FITNESS-BAND', 'Fitness Band / Tracker', 'smartwatches', ['color'], { connectivity: 'Bluetooth' }],
  // ── MEN'S FASHION ─────────────────────────────────────────────────────────
  ['FAMILY-MENS-TSHIRT-ROUND', "Men's Round Neck T-Shirt", 'mens-tshirts', ['color', 'size'], { gender: 'Men', collar_type: 'Round Neck', sleeve_length: 'Half Sleeve' }],
  ['FAMILY-MENS-TSHIRT-POLO', "Men's Polo T-Shirt", 'mens-tshirts', ['color', 'size'], { gender: 'Men', collar_type: 'Polo' }],
  ['FAMILY-MENS-TSHIRT-GRAPHIC', "Men's Graphic T-Shirt", 'mens-tshirts', ['color', 'size'], { gender: 'Men', pattern: 'Printed' }],
  ['FAMILY-MENS-SHIRT-FORMAL', "Men's Formal Shirt", 'mens-shirts', ['color', 'size'], { gender: 'Men', occasion: 'Formal' }],
  ['FAMILY-MENS-SHIRT-CASUAL', "Men's Casual Shirt", 'mens-shirts', ['color', 'size'], { gender: 'Men', occasion: 'Casual' }],
  ['FAMILY-MENS-SHIRT-LINEN', "Men's Linen Shirt", 'mens-shirts', ['color', 'size'], { gender: 'Men', material: 'Linen' }],
  ['FAMILY-MENS-JEANS-SLIM', "Men's Slim Fit Jeans", 'mens-jeans', ['color', 'size'], { gender: 'Men', fit: 'Slim Fit', material: 'Denim' }],
  ['FAMILY-MENS-JEANS-REGULAR', "Men's Regular Fit Jeans", 'mens-jeans', ['color', 'size'], { gender: 'Men', fit: 'Regular Fit', material: 'Denim' }],
  ['FAMILY-MENS-CHINOS', "Men's Chino Trousers", 'mens-jeans', ['color', 'size'], { gender: 'Men', material: 'Cotton Blend' }],
  ['FAMILY-MENS-CARGO', "Men's Cargo Pants", 'mens-jeans', ['color', 'size'], { gender: 'Men', fit: 'Regular Fit' }],
  ['FAMILY-MENS-SHORTS', "Men's Shorts", 'mens-jeans', ['color', 'size'], { gender: 'Men' }],
  ['FAMILY-MENS-KURTA', "Men's Kurta", 'mens-ethnic', ['color', 'size'], { gender: 'Men', occasion: 'Ethnic' }],
  ['FAMILY-MENS-SHERWANI', "Men's Sherwani", 'mens-ethnic', ['color', 'size'], { gender: 'Men', occasion: 'Wedding' }],
  ['FAMILY-MENS-JACKET-CASUAL', "Men's Casual Jacket", 'mens-jackets', ['color', 'size'], { gender: 'Men', occasion: 'Casual' }],
  ['FAMILY-MENS-BLAZER', "Men's Blazer", 'mens-jackets', ['color', 'size'], { gender: 'Men', occasion: 'Formal' }],
  ['FAMILY-MENS-TRACKPANT', "Men's Track Pants", 'mens-activewear', ['color', 'size'], { gender: 'Men', occasion: 'Sports' }],
  ['FAMILY-MENS-INNERWEAR-BRIEF', "Men's Briefs", 'mens-innerwear', ['color', 'size'], { gender: 'Men' }],
  // ── WOMEN'S FASHION ───────────────────────────────────────────────────────
  ['FAMILY-SAREE-SILK', 'Silk Saree', 'sarees', ['color'], { material: 'Silk', occasion: 'Festive' }],
  ['FAMILY-SAREE-COTTON', 'Cotton Saree', 'sarees', ['color'], { material: 'Cotton', occasion: 'Casual' }],
  ['FAMILY-SAREE-DESIGNER', 'Designer Saree', 'sarees', ['color'], { occasion: 'Party' }],
  ['FAMILY-KURTA-ANARKALI', 'Anarkali Kurta', 'kurtas-suits', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-KURTA-STRAIGHT', 'Straight Kurta', 'kurtas-suits', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-KURTI-PALAZZO', 'Kurti with Palazzo Set', 'kurtas-suits', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-LEHENGA-BRIDAL', 'Bridal Lehenga Choli', 'lehengas', ['color', 'size'], { occasion: 'Wedding', gender: 'Women' }],
  ['FAMILY-LEHENGA-PARTY', 'Party Wear Lehenga', 'lehengas', ['color', 'size'], { occasion: 'Party', gender: 'Women' }],
  ['FAMILY-WOMENS-TOP-CASUAL', "Women's Casual Top", 'western-tops', ['color', 'size'], { gender: 'Women', occasion: 'Casual' }],
  ['FAMILY-WOMENS-CROP-TOP', "Women's Crop Top", 'western-tops', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-WOMENS-DRESS-MAXI', 'Maxi Dress', 'dresses', ['color', 'size'], { gender: 'Women', occasion: 'Casual' }],
  ['FAMILY-WOMENS-DRESS-PARTY', 'Party Dress', 'dresses', ['color', 'size'], { gender: 'Women', occasion: 'Party' }],
  ['FAMILY-WOMENS-JUMPSUIT', 'Women\'s Jumpsuit', 'dresses', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-WOMENS-JEANS-SKINNY', "Women's Skinny Jeans", 'womens-bottoms', ['color', 'size'], { gender: 'Women', fit: 'Skinny Fit' }],
  ['FAMILY-PALAZZO', 'Palazzo Pants', 'womens-bottoms', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-WOMENS-ACTIVEWEAR', "Women's Activewear Set", 'womens-activewear', ['color', 'size'], { gender: 'Women', occasion: 'Sports' }],
  ['FAMILY-SPORTS-BRA', 'Sports Bra', 'lingerie', ['color', 'size'], { gender: 'Women' }],
  ['FAMILY-BRA', 'Bra', 'lingerie', ['color', 'size'], { gender: 'Women' }],
  // ── KIDS FASHION ──────────────────────────────────────────────────────────
  ['FAMILY-BOYS-TSHIRT', "Boys' T-Shirt", 'boys-clothing', ['color', 'size'], { gender: 'Boys' }],
  ['FAMILY-BOYS-JEANS', "Boys' Jeans", 'boys-clothing', ['color', 'size'], { gender: 'Boys' }],
  ['FAMILY-GIRLS-FROCK', "Girls' Frock / Dress", 'girls-clothing', ['color', 'size'], { gender: 'Girls' }],
  ['FAMILY-GIRLS-LEHENGA', "Girls' Lehenga Choli", 'girls-clothing', ['color', 'size'], { gender: 'Girls' }],
  ['FAMILY-BABY-ONESIE', 'Baby Onesie / Bodysuit', 'infant-wear', ['color', 'size'], {}],
  // ── FOOTWEAR ──────────────────────────────────────────────────────────────
  ['FAMILY-MENS-SNEAKERS', "Men's Sneakers", 'mens-shoes', ['color', 'shoe-size'], { gender: 'Men' }],
  ['FAMILY-MENS-RUNNING-SHOES', "Men's Running Shoes", 'mens-shoes', ['color', 'shoe-size'], { gender: 'Men', occasion: 'Sports' }],
  ['FAMILY-MENS-FORMAL-SHOES', "Men's Formal Shoes", 'mens-shoes', ['color', 'shoe-size'], { gender: 'Men', occasion: 'Formal' }],
  ['FAMILY-MENS-SANDALS', "Men's Sandals & Floaters", 'mens-shoes', ['color', 'shoe-size'], { gender: 'Men' }],
  ['FAMILY-WOMENS-HEELS', "Women's High Heels", 'womens-shoes', ['color', 'shoe-size'], { gender: 'Women' }],
  ['FAMILY-WOMENS-FLATS', "Women's Ballet Flats", 'womens-shoes', ['color', 'shoe-size'], { gender: 'Women' }],
  ['FAMILY-WOMENS-SNEAKERS', "Women's Sneakers", 'womens-shoes', ['color', 'shoe-size'], { gender: 'Women' }],
  ['FAMILY-FLIP-FLOPS', 'Flip-Flops / Slippers', 'slippers', ['color', 'shoe-size'], {}],
  ['FAMILY-KIDS-SCHOOL-SHOES', "Kids' School Shoes", 'kids-shoes', ['color', 'shoe-size'], {}],
  // ── BEAUTY ────────────────────────────────────────────────────────────────
  ['FAMILY-FACE-MOISTURIZER', 'Face Moisturizer / Cream', 'skincare', ['volume'], {}],
  ['FAMILY-FACE-SERUM', 'Face Serum', 'skincare', ['volume'], {}],
  ['FAMILY-SUNSCREEN', 'Sunscreen / SPF Lotion', 'skincare', ['volume', 'spf'], {}],
  ['FAMILY-FACE-WASH', 'Face Wash / Cleanser', 'skincare', ['volume'], {}],
  ['FAMILY-FACE-MASK', 'Face Mask / Pack', 'skincare', ['volume'], {}],
  ['FAMILY-LIPSTICK', 'Lipstick', 'makeup', ['color'], {}],
  ['FAMILY-FOUNDATION', 'Foundation / BB Cream', 'makeup', ['color', 'volume'], { skin_type: 'All Skin Types' }],
  ['FAMILY-KAJAL-EYELINER', 'Kajal & Eyeliner', 'makeup', ['color'], {}],
  ['FAMILY-EYESHADOW-PALETTE', 'Eyeshadow Palette', 'makeup', ['color'], {}],
  ['FAMILY-MASCARA', 'Mascara', 'makeup', ['color'], {}],
  ['FAMILY-SHAMPOO', 'Shampoo', 'haircare', ['volume'], {}],
  ['FAMILY-CONDITIONER', 'Conditioner', 'haircare', ['volume'], {}],
  ['FAMILY-HAIR-OIL', 'Hair Oil', 'haircare', ['volume'], {}],
  ['FAMILY-BODY-LOTION', 'Body Lotion / Moisturizer', 'bodycare', ['volume'], {}],
  ['FAMILY-DEODORANT', 'Deodorant / Body Spray', 'bodycare', ['volume'], {}],
  ['FAMILY-PERFUME-WOMEN', "Women's Perfume / EDP", 'fragrances', ['volume'], {}],
  ['FAMILY-PERFUME-MEN', "Men's Perfume / EDT", 'fragrances', ['volume'], {}],
  ['FAMILY-ATTAR', 'Attar / Itr (Alcohol-Free)', 'fragrances', ['volume'], {}],
  ['FAMILY-BEARD-OIL', 'Beard Oil & Balm', 'mens-grooming', ['volume'], {}],
  ['FAMILY-SHAVING-CREAM', 'Shaving Cream / Gel', 'mens-grooming', ['volume'], {}],
  ['FAMILY-TOOTHPASTE', 'Toothpaste', 'oral-care', ['pack-size'], {}],
  // ── APPLIANCES ────────────────────────────────────────────────────────────
  ['FAMILY-WASHING-MACHINE-FL', 'Front Load Washing Machine', 'washing-machines', ['capacity'], { energy_rating: '5 Star' }],
  ['FAMILY-WASHING-MACHINE-TL', 'Top Load Washing Machine', 'washing-machines', ['capacity'], { energy_rating: '5 Star' }],
  ['FAMILY-REFRIGERATOR-DD', 'Double Door Refrigerator', 'refrigerators', ['color', 'capacity'], {}],
  ['FAMILY-REFRIGERATOR-SD', 'Single Door Refrigerator', 'refrigerators', ['color', 'capacity'], {}],
  ['FAMILY-AC-SPLIT', 'Split Air Conditioner', 'air-conditioners', ['capacity'], { energy_rating: '5 Star' }],
  ['FAMILY-AC-WINDOW', 'Window Air Conditioner', 'air-conditioners', ['capacity'], {}],
  ['FAMILY-MICROWAVE-SOLO', 'Solo Microwave Oven', 'microwave-ovens', ['color', 'capacity'], {}],
  ['FAMILY-MICROWAVE-CONV', 'Convection Microwave Oven', 'microwave-ovens', ['color', 'capacity'], {}],
  ['FAMILY-WATER-PURIFIER-RO', 'RO Water Purifier', 'water-purifiers', ['capacity'], {}],
  ['FAMILY-GEYSER-STORAGE', 'Storage Water Heater / Geyser', 'geysers', ['capacity'], {}],
  ['FAMILY-CEILING-FAN', 'Ceiling Fan', 'fans-coolers', ['color'], { energy_rating: '5 Star' }],
  ['FAMILY-AIR-COOLER-DESERT', 'Desert Air Cooler', 'fans-coolers', ['color', 'capacity'], {}],
  ['FAMILY-KITCHEN-CHIMNEY', 'Kitchen Chimney / Hood', 'kitchen-chimneys', ['color'], {}],
  ['FAMILY-MIXER-GRINDER', 'Mixer Grinder', 'small-appliances', ['color', 'capacity'], {}],
  ['FAMILY-JUICER', 'Juicer Mixer Grinder', 'small-appliances', ['color', 'capacity'], {}],
  ['FAMILY-ELECTRIC-KETTLE', 'Electric Kettle', 'small-appliances', ['color', 'capacity'], {}],
  ['FAMILY-AIR-FRYER', 'Air Fryer', 'small-appliances', ['color', 'capacity'], {}],
  ['FAMILY-INDUCTION-COOKTOP', 'Induction Cooktop', 'kitchen-chimneys', ['color'], {}],
  ['FAMILY-RICE-COOKER', 'Electric Rice Cooker', 'small-appliances', ['color', 'capacity'], {}],
  ['FAMILY-COFFEE-MAKER', 'Coffee Maker', 'small-appliances', ['color', 'capacity'], {}],
  // ── HOME & KITCHEN ────────────────────────────────────────────────────────
  ['FAMILY-NON-STICK-PAN', 'Non-Stick Frying Pan', 'cookware', ['color', 'capacity'], {}],
  ['FAMILY-PRESSURE-COOKER', 'Pressure Cooker', 'cookware', ['capacity'], { material: 'Stainless Steel' }],
  ['FAMILY-CASSEROLE', 'Casserole / Serving Bowl', 'cookware', ['color', 'capacity'], {}],
  ['FAMILY-DINNER-SET', 'Dinner Set (Crockery)', 'tableware', ['color', 'pack-size'], { material: 'Ceramic' }],
  ['FAMILY-WATER-BOTTLE', 'Water Bottle / Sipper', 'kitchen-storage', ['color', 'capacity'], {}],
  ['FAMILY-LUNCH-BOX', 'Lunch Box / Tiffin', 'kitchen-storage', ['color', 'pack-size'], {}],
  ['FAMILY-BEDSHEET-KING', 'King Size Bedsheet Set', 'home-textiles', ['color'], {}],
  ['FAMILY-BEDSHEET-QUEEN', 'Queen / Double Bedsheet Set', 'home-textiles', ['color'], {}],
  ['FAMILY-CURTAINS', 'Curtains (Pair)', 'home-textiles', ['color'], {}],
  ['FAMILY-BATH-TOWEL', 'Bath Towel Set', 'home-textiles', ['color'], {}],
  ['FAMILY-CUSHION-COVER', 'Cushion Cover (Pack of 5)', 'home-textiles', ['color', 'pattern'], {}],
  ['FAMILY-WALL-CLOCK', 'Wall Clock', 'home-decor', ['color'], {}],
  ['FAMILY-PHOTO-FRAME', 'Photo Frame / Wall Frame', 'home-decor', ['color'], {}],
  ['FAMILY-FLOOR-LAMP', 'Floor Lamp', 'home-decor', ['color'], {}],
  // ── FURNITURE ─────────────────────────────────────────────────────────────
  ['FAMILY-SOFA-3SEATER', '3-Seater Sofa', 'living-room-furniture', ['color', 'finish'], { material: 'Fabric' }],
  ['FAMILY-SOFA-L-SHAPE', 'L-Shaped Sofa', 'living-room-furniture', ['color', 'finish'], {}],
  ['FAMILY-RECLINER', 'Recliner Chair', 'living-room-furniture', ['color'], {}],
  ['FAMILY-BED-KING', 'King Size Bed', 'bedroom-furniture', ['color', 'finish'], { material_furniture: 'Engineered Wood' }],
  ['FAMILY-BED-QUEEN', 'Queen Size Bed', 'bedroom-furniture', ['color', 'finish'], {}],
  ['FAMILY-WARDROBE-3DOOR', '3-Door Wardrobe', 'bedroom-furniture', ['color', 'finish'], {}],
  ['FAMILY-MATTRESS-FOAM', 'Memory Foam Mattress', 'bedroom-furniture', ['capacity'], {}],
  ['FAMILY-DINING-SET-6', '6-Seater Dining Table Set', 'dining-furniture', ['color', 'finish'], {}],
  ['FAMILY-OFFICE-CHAIR-ERGO', 'Ergonomic Office Chair', 'office-study-furniture', ['color'], {}],
  ['FAMILY-STUDY-TABLE', 'Study / Writing Table', 'office-study-furniture', ['color', 'finish'], {}],
  ['FAMILY-BOOKSHELF', 'Bookshelf / Open Shelf', 'office-study-furniture', ['color', 'finish'], {}],
  ['FAMILY-TV-UNIT', 'TV Unit / Entertainment Unit', 'living-room-furniture', ['color', 'finish'], {}],
  ['FAMILY-SHOE-RACK', 'Shoe Rack', 'living-room-furniture', ['color', 'finish'], {}],
  ['FAMILY-COFFEE-TABLE', 'Coffee Table / Center Table', 'living-room-furniture', ['color', 'finish'], {}],
  ['FAMILY-BEAN-BAG', 'Bean Bag', 'living-room-furniture', ['color'], {}],
  // ── HEALTH & FITNESS ──────────────────────────────────────────────────────
  ['FAMILY-PROTEIN-POWDER', 'Whey Protein Powder', 'vitamins-supplements', ['flavor', 'pack-size'], {}],
  ['FAMILY-MASS-GAINER', 'Mass Gainer Supplement', 'vitamins-supplements', ['flavor', 'pack-size'], {}],
  ['FAMILY-MULTIVITAMIN', 'Multivitamin Tablets / Capsules', 'vitamins-supplements', ['pack-size'], {}],
  ['FAMILY-OMEGA3', 'Omega-3 / Fish Oil Capsules', 'vitamins-supplements', ['pack-size'], {}],
  ['FAMILY-YOGA-MAT', 'Yoga Mat', 'yoga', ['color'], {}],
  ['FAMILY-DUMBBELLS-SET', 'Dumbbells Set', 'gym-fitness', ['color'], {}],
  ['FAMILY-RESISTANCE-BANDS', 'Resistance Bands Set', 'gym-fitness', ['color'], {}],
  ['FAMILY-SKIPPING-ROPE', 'Skipping / Jump Rope', 'gym-fitness', ['color'], {}],
  ['FAMILY-TREADMILL', 'Treadmill (Motorized)', 'gym-fitness', ['color'], {}],
  ['FAMILY-EXERCISE-CYCLE', 'Exercise / Stationary Cycle', 'gym-fitness', ['color'], {}],
  // ── SPORTS ────────────────────────────────────────────────────────────────
  ['FAMILY-CRICKET-BAT-EW', 'Cricket Bat (English Willow)', 'cricket', ['color'], {}],
  ['FAMILY-CRICKET-KIT', 'Cricket Kit (Complete)', 'cricket', ['color'], {}],
  ['FAMILY-FOOTBALL', 'Football / Soccer Ball', 'football', ['color'], {}],
  ['FAMILY-BADMINTON-RACKET', 'Badminton Racket', 'badminton', ['color'], {}],
  ['FAMILY-BADMINTON-SET', 'Badminton Set (2 Rackets + Shuttlecocks)', 'badminton', ['color'], {}],
  // ── TOYS & BABY ───────────────────────────────────────────────────────────
  ['FAMILY-LEGO-SET', 'LEGO Building Blocks Set', 'educational-toys', ['color'], {}],
  ['FAMILY-BOARD-GAME', 'Board Game', 'educational-toys', ['color'], {}],
  ['FAMILY-RC-CAR', 'Remote Control Car / Toy Car', 'action-figures', ['color'], {}],
  ['FAMILY-PLUSH-TOY-TEDDY', 'Teddy Bear / Stuffed Animal', 'soft-toys', ['color'], {}],
  ['FAMILY-BABY-STROLLER', 'Baby Stroller / Pram', 'baby-products', ['color'], {}],
  ['FAMILY-FEEDING-BOTTLE', 'Baby Feeding Bottle Set', 'baby-products', ['color', 'pack-size'], {}],
  ['FAMILY-KIDS-CYCLE', 'Kids Bicycle / Cycle', 'outdoor-play', ['color'], {}],
  ['FAMILY-KIDS-SCOOTER', 'Kids Scooter', 'outdoor-play', ['color'], {}],
  // ── AUTOMOTIVE ────────────────────────────────────────────────────────────
  ['FAMILY-CAR-SEAT-COVER', 'Car Seat Cover Set', 'car-accessories', ['color'], {}],
  ['FAMILY-DASH-CAM', 'Dash Camera', 'car-electronics', ['color'], {}],
  ['FAMILY-CAR-CHARGER', 'Car Charger (USB / Type-C)', 'car-accessories', ['color'], {}],
  ['FAMILY-ENGINE-OIL', 'Engine Oil (4L Can)', 'oils-fluids', ['capacity'], {}],
  ['FAMILY-BIKE-HELMET', 'Motorcycle Helmet (Full Face)', 'bike-accessories', ['color'], {}],
  // ── JEWELRY ───────────────────────────────────────────────────────────────
  ['FAMILY-GOLD-NECKLACE', 'Gold Necklace', 'gold-jewelry', ['metal'], {}],
  ['FAMILY-GOLD-BANGLE', 'Gold Bangle', 'gold-jewelry', ['metal', 'purity'], {}],
  ['FAMILY-GOLD-EARRING', 'Gold Earring / Jhumka', 'gold-jewelry', ['metal'], {}],
  ['FAMILY-DIAMOND-RING', 'Diamond Solitaire Ring', 'diamond-jewelry', ['metal'], {}],
  ['FAMILY-SILVER-PAYAL', 'Silver Anklet / Payal', 'silver-jewelry', ['metal'], {}],
  ['FAMILY-FASHION-JHUMKA', 'Jhumka (Fashion Jewelry)', 'fashion-jewelry', ['color', 'metal'], {}],
  ['FAMILY-OXIDISED-SET', 'Oxidised Jewelry Set', 'fashion-jewelry', ['color'], {}],
  ['FAMILY-KUNDAN-SET', 'Kundan Jewelry Set', 'fashion-jewelry', ['color'], {}],
  // ── WATCHES ───────────────────────────────────────────────────────────────
  ['FAMILY-MENS-ANALOG-WATCH', "Men's Analog Watch", 'mens-watches', ['color'], { gender: 'Men' }],
  ['FAMILY-MENS-DIGITAL-WATCH', "Men's Digital Watch", 'mens-watches', ['color'], { gender: 'Men' }],
  ['FAMILY-WOMENS-ANALOG-WATCH', "Women's Analog Watch", 'womens-watches', ['color'], { gender: 'Women' }],
  // ── BAGS & LUGGAGE ────────────────────────────────────────────────────────
  ['FAMILY-TROLLEY-CABIN', 'Cabin Trolley Bag (18-20")', 'luggage', ['color'], {}],
  ['FAMILY-TROLLEY-CHECKIN', 'Check-in Trolley Bag (24-28")', 'luggage', ['color'], {}],
  ['FAMILY-TOTE-BAG', 'Tote Bag', 'handbags', ['color'], {}],
  ['FAMILY-SLING-BAG', 'Sling Bag / Crossbody Bag', 'handbags', ['color'], {}],
  ['FAMILY-LAPTOP-BACKPACK', 'Laptop Backpack (15")', 'backpacks', ['color'], {}],
  ['FAMILY-SCHOOL-BAG', 'School Bag / College Bag', 'backpacks', ['color'], {}],
  ['FAMILY-MENS-WALLET', "Men's Wallet (Leather)", 'wallets', ['color'], { gender: 'Men' }],
  // ── FOOD & BEVERAGES ──────────────────────────────────────────────────────
  ['FAMILY-CHIPS', 'Chips & Crisps', 'snacks-namkeen', ['flavor', 'pack-size'], {}],
  ['FAMILY-NAMKEEN', 'Namkeen / Bhujia Mix', 'snacks-namkeen', ['flavor', 'pack-size'], {}],
  ['FAMILY-CHOCOLATE-BAR', 'Chocolate Bar', 'chocolate-sweets', ['flavor', 'pack-size'], {}],
  ['FAMILY-BISCUITS', 'Biscuits / Cookies Pack', 'snacks-namkeen', ['flavor', 'pack-size'], {}],
  ['FAMILY-INSTANT-COFFEE', 'Instant Coffee', 'beverages', ['flavor', 'pack-size'], {}],
  ['FAMILY-TEA-BAGS', 'Tea Bags', 'beverages', ['flavor', 'pack-size'], {}],
  ['FAMILY-FRUIT-JUICE', 'Fruit Juice / Nectar', 'beverages', ['flavor', 'pack-size'], {}],
  ['FAMILY-SPICE-BLEND', 'Spice Blend / Masala Powder', 'condiments-spices', ['flavor', 'pack-size'], {}],
  // ── GAMING ────────────────────────────────────────────────────────────────
  ['FAMILY-GAMING-CONSOLE', 'Gaming Console', 'consoles', ['color', 'storage'], {}],
  ['FAMILY-GAMING-MOUSE', 'Gaming Mouse', 'pc-gaming', ['color'], {}],
  ['FAMILY-MECHANICAL-KEYBOARD', 'Mechanical Gaming Keyboard', 'pc-gaming', ['color'], {}],
  ['FAMILY-GAMING-CHAIR', 'Gaming Chair', 'pc-gaming', ['color'], {}],
  // ── MUSICAL INSTRUMENTS ───────────────────────────────────────────────────
  ['FAMILY-ACOUSTIC-GUITAR', 'Acoustic Guitar', 'string-instruments', ['color'], {}],
  ['FAMILY-ELECTRIC-GUITAR', 'Electric Guitar', 'string-instruments', ['color'], {}],
  ['FAMILY-KEYBOARD-DIGITAL', 'Digital Piano / Keyboard', 'keyboard-piano', ['color'], {}],
  ['FAMILY-TABLA-SET', 'Tabla Set', 'drums-percussion', ['color'], {}],
  // ── CAMERAS ───────────────────────────────────────────────────────────────
  ['FAMILY-DSLR-CAMERA', 'DSLR Camera Body', 'cameras-photo', ['color'], {}],
  ['FAMILY-MIRRORLESS-CAMERA', 'Mirrorless Camera Body', 'cameras-photo', ['color'], {}],
  ['FAMILY-ACTION-CAMERA', 'Action Camera (GoPro etc)', 'cameras-photo', ['color'], {}],
];

class FamiliesSeed {
  constructor() {
    this.logger = new SeedLogger('Families');
    this.mongoose = mongoose;
  }

  async execute() {
    const conn = this.mongoose.connection;
    if (!conn || !conn.collection) throw new Error('MongoDB connection not available');
    this.logger.info(`👨‍👩‍👧 Seeding Product Families — ${FAMILIES.length} families`);

    await conn.collection('productfamilies').deleteMany({});

    // Find a system seller ID or use placeholder
    const systemSeller = 'system-seller-001';

    const docs = FAMILIES.map(([familyCode, title, category, variantAxes, baseAttributes]) => ({
      _id: new mongoose.Types.ObjectId(),
      familyCode,
      sellerId: systemSeller,
      title,
      category,
      baseAttributes: baseAttributes || {},
      variantAxes: variantAxes || [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const BATCH = 100;
    for (let i = 0; i < docs.length; i += BATCH) {
      await conn.collection('productfamilies').insertMany(docs.slice(i, i + BATCH));
      this.logger.recordBatch(Math.min(BATCH, docs.length - i));
    }

    this.logger.printStats();
    return { created: docs.length };
  }
}

module.exports = FamiliesSeed;

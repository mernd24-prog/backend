const image = (url, alt = "") => ({ url, alt });
const point = (title, description = "", extra = {}) => ({
  title,
  description,
  ...extra,
});

function page(slug, title, data = {}) {
  return {
    slug,
    title,
    pageType: data.pageType || "page",
    status: "published",
    published: true,
    publishedAt: new Date(),
    description: data.description || data.excerpt || "",
    excerpt: data.excerpt || "",
    image: data.image || {},
    sections: data.sections || [],
    points: data.points || [],
    cta: data.cta || {},
    category: data.category || "customer-cms",
    tags: ["customer", "cms", "fallback"],
    visibility: { channels: ["web", "mobile"], roles: ["customer"] },
    language: "en",
    metadata: {
      source: "customer-fallback",
      customerCmsKey: slug,
      data: {
        slug,
        title,
        ...data,
      },
    },
  };
}

const sellerPolicy = {
  pageType: "policy",
  excerpt: "Seller Guidelines",
  description:
    "Standards and responsibilities that create a trusted experience for sellers and customers.",
  image: image("/image/png/fallback/sellerPolicy.webp", "Seller Policy"),
  cta: { label: "Become a Seller", url: "/become-a-seller" },
  sections: [
    {
      type: "policy-highlights",
      title: "Everything You Need To Sell Confidently",
      description:
        "Our marketplace policies protect sellers and strengthen customer confidence.",
      points: [
        point(
          "Genuine Products",
          "Sell only authentic and legally sourced products.",
        ),
        point(
          "Accurate Listings",
          "Provide correct titles, images, pricing and specifications.",
        ),
        point(
          "Timely Shipping",
          "Dispatch orders within the promised timeline.",
        ),
      ],
    },
    {
      type: "seller-responsibilities",
      title: "Your Commitment Matters",
      description:
        "Follow these responsibilities to provide a trusted shopping experience.",
      points: [
        point(
          "List Authentic Products",
          "Upload only original products with complete details.",
        ),
        point(
          "Maintain Accurate Listings",
          "Keep pricing, stock, and information updated.",
        ),
        point(
          "Process Orders Quickly",
          "Accept, pack and dispatch every order on time.",
        ),
        point(
          "Support Customers",
          "Respond professionally to customer queries and returns.",
        ),
      ],
    },
    {
      type: "account-compliance",
      title: "Maintain a Healthy Seller Account",
      description: "We monitor seller performance to ensure reliable service.",
      points: [
        point(
          "Good Standing",
          "Maintain accurate listings, timely shipping, and quality service.",
        ),
        point(
          "Performance Review",
          "Accounts are reviewed using fulfillment and satisfaction data.",
        ),
        point(
          "Policy Violations",
          "Repeated violations can lead to account restrictions.",
        ),
      ],
    },
  ],
};

const heroSlides = [
  [
    "HeroImg1.webp",
    "END OF SEASON SALE | UP TO 50% OFF",
    "Shop Smarter Across\nEvery Category",
    "Discover premium accessories, smart gadgets, travel gear, and everyday essentials designed to complement your modern lifestyle.",
  ],
  [
    "HeroImg2.jpg",
    "NEW ARRIVALS",
    "Upgrade Your Daily\nLifestyle Essentials",
    "From premium laptops and wireless headphones to everyday gadgets and accessories, find everything you need at unbeatable prices.",
  ],
  [
    "HeroImg3.jpg",
    "LIMITED TIME OFFERS | SAVE UP TO 50%",
    "Upgrade Your Lifestyle\nWith Smart Tech",
    "Discover stylish fashion, beauty, and everyday essentials curated for every occasion. Find quality products that bring comfort, confidence, and effortless style to your everyday life.",
  ],
];

const sellerStories = [
  [
    "Sam Bhatia",
    "The Bear House is a contemporary menswear brand offering premium shirts, T-shirts, trousers, and stylish everyday clothing. With a focus on modern designs, quality fabrics, and versatile fashion, the brand brings together comfort, sophistication, and effortless style for today's men.",
    "SellerStory.avif",
    "The Bear House",
    "3.2x growth in 8 months",
  ],
  // [
  //   "Nisha Kapoor",
  //   "The seller tools help us make better decisions every week.",
  //   "SellerStory1.webp",
  //   "Owner, Nivara Studio",
  //   "18,000+ orders delivered",
  // ],
  // [
  //   "Kabir Shah",
  //   "Reliable payouts gave us the confidence to scale.",
  //   "SellerStory2.webp",
  //   "Director, K&S Essentials",
  //   "200+ products listed",
  // ],
  // [
  //   "Riya Malhotra",
  //   "The marketplace helped our family-run brand find customers beyond our city.",
  //   "SellerStory3.webp",
  //   "Co-founder, Terra Crafts",
  //   "42 cities reached",
  // ],
  // [
  //   "Dev Arora",
  //   "Sam Global made online selling feel approachable from day one.",
  //   "SellerStory4.webp",
  //   "Owner, Volt Avenue",
  //   "4.8 average rating",
  // ],
  // [
  //   "Meera Iyer",
  //   "Simple tools and dependable support let us focus on our customers.",
  //   "SellerStory5.webp",
  //   "Founder, Studio Meera",
  //   "2.5x monthly growth",
  // ],
].map(([title, description, file, role, result]) => ({
  title,
  description,
  image: image(`/image/png/fallback/become-a-seller/${file}`, title),
  metadata: { role },
  cta: { label: result },
}));

const footerLinkSection = (title, links) => ({
  type: "links",
  title,
  points: links.map(([label, url, target = "_self"]) =>
    point(label, "", { cta: { label, url, target } }),
  ),
});

const customerCmsFallbackPages = [
  page("contact-us", "Contact us", {
    pageType: "contact",
    excerpt:
      "Get in touch with Sam Global for support, inquiries, or feedback.",
    sections: [
      {
        type: "content",
        title: "contact-info",
        points: [
          point("Email", "info@samglobal1.com"),
          point("Phone", "+91 99154 29897"),
          point("Working Hours", "Mon - Sat\n9 AM - 7 PM"),
          point(
            "Office",
            "202, KINGSTON1 OMAXE ROYAL RESIDENCY, PAKHOWAL ROAD, Lalton Kalan, Ludhiana, Punjab 142022",
          ),
        ],
      },
      {
        type: "content",
        title: "subject",
        points: [
          "Order Issue",
          "Payment",
          "Return",
          "Seller Support",
          "Technical",
        ].map((title) => point(title)),
      },
    ],
  }),
  page("support-center", "Help & Support", {
    pageType: "support",
    description:
      "Find answers, track orders, manage returns, or contact our support team.",
    sections: [
      {
        type: "all-help-topics",
        title: "All Help Topics",
        points: [
          [
            "Track Order",
            "Track your current orders",
            "Track-order.png",
            "/orders",
          ],
          [
            "Return & Refund",
            "Manage returns and refunds",
            "Return-refund.png",
            "/returns-refunds",
          ],
          [
            "Payment Issues",
            "Get help with payments",
            "payment-issues.png",
            "/payments",
          ],
          [
            "Rewards Help",
            "Get help with rewards",
            "account-security.png",
            "#",
          ],
          [
            "Account Security",
            "Manage and protect your account",
            "account-security.png",
            "/account/profile",
          ],
        ].map(([title, description, file, url]) =>
          point(title, description, {
            image: image(`/image/png/fallback/Help&Support/${file}`, title),
            cta: { url },
          }),
        ),
      },
      {
        type: "contact-support",
        title: "Contact Support",
        points: [
          point("+91 99154 29897", "Call Us", { cta: { url: "/contact-us" } }),
          point("info@samglobal1.com", "Email Support", {
            cta: { url: "/contact-us" },
          }),
          point("Raise a Ticket", "Submit a ticket and we will get back", {
            cta: { url: "/support" },
          }),
        ],
      },
    ],
  }),
  page("become-a-seller", "Grow Your Business\nWith Sam Global", {
    pageType: "seller",
    excerpt:
      "Reach more customers, manage orders easily, and grow with reliable support.",
    image: image("/image/png/fallback/sellerBanner.webp", "Sam Global seller"),
    sections: [
      {
        type: "seller-stories",
        points: sellerStories,
      },
      {
        type: "seller-benefits",
        title: "Why sell with us",
        description: "Everything you need to build a thriving online business.",
        points: [
          point(
            "Transparent earnings",
            "Clear fees and dependable payment cycles.",
          ),
          point("Nationwide reach", "Reach customers across India."),
          point("Insights that help", "Understand product performance."),
        ],
      },
      {
        type: "seller-steps",
        title: "Start selling",
        description: "Set up your storefront in a few simple steps.",
        points: [
          point(
            "Create your account",
            "Register your business and share basic details.",
          ),
          point(
            "Build your storefront",
            "Add products, pricing, and inventory.",
          ),
          point(
            "Receive and ship orders",
            "Manage orders from your seller dashboard.",
          ),
          point("Get paid and grow", "Track payouts and performance insights."),
        ],
      },
    ],
  }),
  page("seller-policy", "Seller Policy", sellerPolicy),
  page("seller-policies", "Seller Policies", sellerPolicy),
  page("Hero Banner", "Home Hero Banner", {
    pageType: "banner",
    sections: heroSlides.map(([file, badge, title, description], index) => ({
      type: "hero-slide",
      title,
      description,
      image: image(`/image/png/fallback/${file}`, title.replace("\n", " ")),
      points: [
        point(badge),
        point("Explore Categories", "", {
          cta: { label: "Explore Categories", url: "/categories" },
        }),
      ],
      cta: { label: "Shop Now", url: "/products" },
      sortOrder: index + 1,
    })),
  }),
  page("promo-campaign-carousel", "Promotional Campaigns", {
    pageType: "campaign",
    sections: [
      {
        type: "promo-cards",
        title: "Featured Promotions",
        points: [
          [
            "Designer Chaniya Cholis",
            "Traditional Festive Elegance",
            "chaniya-choli1.webp",
            "Explore now",
          ],
          [
            "Garba Special Collection",
            "Dandiya Night Favorites",
            "chaniya-choli2.webp",
            "Explore now",
          ],
          [
            "Navratri Ethnic Wear",
            "Vibrant & Unique Styles",
            "chaniya-choli3.webp",
            "Explore",
          ],
          [
            "Festive Lehengas",
            "Glow in vibrant festive hues",
            "chaniya-choli4.webp",
            "Explore now",
          ],
        ].map(([title, description, file, ctaLabel]) =>
          point(title, description, {
            image: image(`/image/png/fallback/${file}`, title),
            cta: { label: ctaLabel, url: "/products" },
          }),
        ),
      },
    ],
  }),
  page("shopping-banner", "Irresistible Brands,\nBest Prices", {
    pageType: "banner",
    description: "50-80",
    image: image("/image/png/fallback/bannerDeals.png", "Best brand deals"),
    points: [point("50-80")],
    cta: { label: "Shop Deals", url: "/deals" },
  }),
  page("header-mega-menu", "Header Mega Menu", {
    pageType: "navigation",
    leftSections: [],
    promo: null,
  }),
  page("deal-products", "Deal Products", {
    pageType: "listing",
    description:
      "Products promoted by admin with special deal price, original price, deal badge, and limited-time availability.",
  }),
  page("privacy-policy", "Privacy Policy", {
    pageType: "policy",
    category: "legal",
    sections: [
      {
        type: "content",
        title: "Your Privacy Matters",
        description:
          "At Sam Global, we are committed to protecting your personal information and ensuring transparency in how your data is collected, used, and safeguarded.",
        points: [
          point(
            "1. Information We Collect",
            "Personal Information: Name, phone number, email address; shipping and billing address\nAccount Information: Login details, preferences, and order history\nTransaction Data: Payment details processed securely via third-party gateways\nTechnical Data: IP address, browser type, device information, website usage and interaction data",
          ),
          point(
            "2. How We Use Your Information",
            "Process and deliver your orders\nProvide customer support\nImprove our platform and user experience\nSend order updates, service notifications, and relevant offers\nPrevent fraud and ensure platform security",
          ),
          point(
            "3. Sharing of Information",
            "We do not sell your personal data.\nWe may share information with logistics partners, payment gateways, technology and analytics providers, and sellers where applicable.\nAll partners are expected to maintain data confidentiality and security.",
          ),
          point(
            "4. Data Security",
            "We implement appropriate technical and organizational measures to protect your data.\nHowever, no system is completely secure, and we cannot guarantee absolute security.",
          ),
          point(
            "5. Cookies & Tracking",
            "We use cookies and similar technologies to enhance browsing, remember preferences, and analyse platform usage.\nRefer to our Cookie Policy for more details.",
          ),
          point(
            "6. Your Rights",
            "Access or update your personal information\nRequest deletion of your data, subject to legal requirements\nOpt out of marketing communications",
          ),
          point(
            "7. Data Retention",
            "We retain data only as long as necessary for order fulfilment, legal and regulatory compliance, and business operations.",
          ),
          point(
            "8. Third-Party Links",
            "Our platform may contain links to external websites. We are not responsible for the privacy practices of such third parties.",
          ),
          point(
            "9. Policy Updates",
            "We may update this Privacy Policy from time to time. Continued use of the platform implies acceptance of the updated policy.",
          ),
          point(
            "10. Contact Us",
            "For any privacy-related concerns, please contact us through our Contact page.\nYour trust is important to us, and we are committed to protecting it.",
          ),
        ],
      },
    ],
  }),
  page("cookie-policy", "Cookie Policy", {
    pageType: "policy",
    category: "legal",
    sections: [
      {
        type: "content",
        title: "Understanding How We Use Cookies",
        description:
          "This Cookie Policy explains how Sam Global uses cookies and similar technologies to enhance your experience on our platform.",
        points: [
          point(
            "1. What Are Cookies?",
            "Cookies are small text files stored on your device when you visit a website. They help improve functionality, performance, and user experience.",
          ),
          point(
            "2. Types of Cookies We Use",
            "Essential Cookies: Required for basic website functionality such as login and checkout.\nPerformance Cookies: Help us understand how users interact with our platform to improve performance.\nFunctional Cookies: Remember your preferences and settings for a personalized experience.\nAdvertising Cookies: Used to deliver relevant ads and measure campaign effectiveness.",
          ),
          point(
            "3. How We Use Cookies",
            "Enable smooth navigation and functionality\nRemember your preferences and login details\nAnalyse website traffic and usage patterns\nImprove performance and user experience\nSupport marketing and advertising efforts",
          ),
          point(
            "4. Third-Party Cookies",
            "We may allow trusted third-party services, such as analytics or advertising platforms, to place cookies on your device. These cookies are governed by the respective third parties’ policies.",
          ),
          point(
            "5. Managing Cookies",
            "You can control or disable cookies through your browser settings. Please note that disabling cookies may affect certain features and functionality of the platform.",
          ),
          point(
            "6. Consent",
            "By continuing to use our platform, you consent to our use of cookies as described in this policy.",
          ),
          point(
            "7. Updates to This Policy",
            "We may update this Cookie Policy from time to time.",
          ),
          point(
            "Closing Line",
            "Designed to enhance your experience while respecting your privacy.",
          ),
        ],
      },
    ],
  }),
  page("footerdata", "footerData", {
    pageType: "footer",
    image: image("/image/webp/logoWithName.webp", "Sam Global"),
    sections: [
      {
        type: "footer-links",
        title: "footer-links",
        points: [
          point("100% Secure Payments", "Multiple sale payment options", {
            image: image("/image/png/fallback/footer/payment.png", "Payment"),
          }),
          point("Easy Returns", "Hassle-free 10 days return", {
            image: image("/image/png/fallback/footer/return.png", "Returns"),
          }),
          point("24/7 Support", "We’re here to help you.", {
            image: image("/image/png/fallback/footer/support.png", "Support"),
          }),
        ],
      },
      footerLinkSection("Sell", [
        ["Become a Seller", "/become-a-seller"],
        ["Seller Dashboard", "http://45.195.90.183:3000/login", "_blank"],
        ["Seller Policies", "/seller-policies"],
      ]),
      footerLinkSection("About SAM", [
        ["Our Story", "/about-us#who-we-are"],
        ["Our Philosophy", "/about-us#our-values"],
        ["What We Are Building", "/about-us#what-we-are-building"],
        ["Privacy Policy", "/privacy-policy"],
        ["Cookie Policy", "/cookie-policy"],
      ]),
      footerLinkSection("Help & Contact", [
        ["Customer Support", "/support"],
        ["Mobile App", "/mobile-app"],
        ["Shipping & Delivery Policy", "/shipping-policy"],
        ["Return & Refund Policy", "/refund-policy"],
        ["Terms of Use", "/terms-of-use"],
        ["FAQ", "/faq"],
      ]),
      {
        type: "appDownload",
        title: "appDownload",
        description:
          "Download our app for a faster and smarter shopping experience.",
        points: [
          point("Download on the App Store", "", {
            image: image(
              "/image/png/fallback/footer/appStore.svg",
              "App Store",
            ),
            cta: { url: "/mobile-app" },
          }),
          point("Get it on Google Play", "", {
            image: image(
              "/image/png/fallback/footer/playStore.svg",
              "Google Play",
            ),
            cta: { url: "/mobile-app" },
          }),
        ],
      },
      {
        type: "copyright",
        title: "copyright",
        description:
          "© 2026 Samglobal Marketplace Pvt. Ltd. All Rights Reserved.",
        points: [
          point("Instagram", "", {
            cta: { label: "Instagram", url: "/Description", target: "_blank" },
          }),
          point("Facebook", "", {
            cta: { label: "Facebook", url: "/Description", target: "_blank" },
          }),
          point("YouTube", "", {
            cta: { label: "YouTube", url: "/Description", target: "_blank" },
          }),
        ],
      },
    ],
  }),
];

module.exports = { customerCmsFallbackPages };

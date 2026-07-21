const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  ContentPageModel,
} = require("../../src/modules/platform/models/content-page.model");
 
 

async function seedPolicyPages() {
  try {
    await connectMongo();

    console.log("✅ MongoDB Connected");

    const pages = [
         {
        slug: "about-banner",
        title: "About Banner",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "banner"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 1,
        language: "en",

        seo: {
          metaTitle: "About Us",
          metaDescription: "About Sam Global",
          keywords: ["about", "sam global"],
          focusKeyword: "About Sam Global",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "About Us",
          ogDescription: "About Sam Global",
          ogImage: {},
          twitterTitle: "About Us",
          twitterDescription: "About Sam Global",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "about-banner",
            title: "",
            description: "",
            image: {
              url: "/image/png/aboutBanner.png",
              alt: "Modern and elegant fashion banner",
              title: "About Banner",
              caption: "",
              type: "image",
            },
            gallery: [],
            points: [],
            cta: {},
            sortOrder: 1,
          },
        ],

        metadata: {},
      },
      {
        slug: "about-sam-global",
        title: "About Sam Global",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "company"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 2,
        language: "en",

        seo: {
          metaTitle: "About Sam Global",
          metaDescription: "Learn more about Sam Global.",
          keywords: ["about", "sam global", "company"],
          focusKeyword: "About Sam Global",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "About Sam Global",
          ogDescription: "Learn more about Sam Global.",
          ogImage: {},
          twitterTitle: "About Sam Global",
          twitterDescription: "Learn more about Sam Global.",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "about-sam-global",
            title: "About Sam Global",
            description:
              "Sam Global is built on over 18+ years of experience in FMCG distribution and customer selling, with a strong foundation in execution and scale.\n\nFrom building high-performance sales networks to now expanding into organized apparel retail, our journey is driven by a clear vision — to create a scalable, execution-focused retail platform across India.\n\nStarting from Ludhiana, we are expanding into key markets with a structured, disciplined approach focused on performance, consistency, and long-term growth.",

            image: {
              url: "/image/png/ourStory.png",
              alt: "About Sam Global",
              title: "About Sam Global",
              caption: "",
              type: "image",
            },

            gallery: [],
            points: [],
            cta: {},
            sortOrder: 1,
          },
        ],

        metadata: {},
      },
      {
        slug: "our-values",
        title: "Our Values",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "values"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 3,
        language: "en",

        seo: {
          metaTitle: "Our Values",
          metaDescription: "The values that define Sam Global.",
          keywords: ["our values", "sam global", "company values"],
          focusKeyword: "Our Values",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "Our Values",
          ogDescription: "The values that define Sam Global.",
          ogImage: {},
          twitterTitle: "Our Values",
          twitterDescription: "The values that define Sam Global.",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "our-values",
            title: "Our Values",
            description: "",

            image: {},
            gallery: [],
            cta: {},
            sortOrder: 1,

            points: [
              {
                title: "Execution Excellence",
                description:
                  "We believe in strong ground-level execution. Every store, every customer interaction, and every process is driven by performance and discipline.",
                image: {
                  url: "/image/png/excellence.png",
                  alt: "Execution Excellence",
                  title: "Execution Excellence",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 1,
              },
              {
                title: "Customer First",
                description:
                  "Our approach is built around understanding Indian consumers and delivering consistent, high-quality retail experiences.",
                image: {
                  url: "/image/png/customer.png",
                  alt: "Customer First",
                  title: "Customer First",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 2,
              },
              {
                title: "Scalable Growth",
                description:
                  "We focus on building systems and processes that enable sustainable, long-term expansion across markets.",
                image: {
                  url: "/image/png/growth.png",
                  alt: "Scalable Growth",
                  title: "Scalable Growth",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 3,
              },
            ],
          },
        ],

        metadata: {},
      },
      {
        slug: "indian-brand",
        title: "Indian Brands",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "brands"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 4,
        language: "en",

        seo: {
          metaTitle: "Indian Brands",
          metaDescription:
            "Discover the trusted brands associated with Sam Global.",
          keywords: ["indian brands", "brands", "sam global"],
          focusKeyword: "Indian Brands",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "Indian Brands",
          ogDescription:
            "Discover the trusted brands associated with Sam Global.",
          ogImage: {},
          twitterTitle: "Indian Brands",
          twitterDescription:
            "Discover the trusted brands associated with Sam Global.",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "indian-brand",
            title: "Indian Brands",
            description:
              "A curated space showcasing trusted brands associated with Sam Global.",

            image: {},
            gallery: [],
            cta: {},
            sortOrder: 1,

            points: [
              {
                title: "Zara",
                description: "",
                image: {
                  url: "/image/png/zara.png",
                  alt: "Zara",
                  title: "Zara",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 1,
              },
              {
                title: "Vogue",
                description: "",
                image: {
                  url: "/image/png/vogue.png",
                  alt: "Vogue",
                  title: "Vogue",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 2,
              },
              {
                title: "Lacoste",
                description: "",
                image: {
                  url: "/image/png/lacoste.png",
                  alt: "Lacoste",
                  title: "Lacoste",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 3,
              },
              {
                title: "GQ",
                description: "",
                image: {
                  url: "/image/png/gq.png",
                  alt: "GQ",
                  title: "GQ",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 4,
              },
              {
                title: "Prada",
                description: "",
                image: {
                  url: "/image/png/prada.png",
                  alt: "Prada",
                  title: "Prada",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 5,
              },
              {
                title: "Gucci",
                description: "",
                image: {
                  url: "/image/png/gucci.png",
                  alt: "Gucci",
                  title: "Gucci",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 6,
              },
            ],
          },
        ],

        metadata: {},
      },
      {
        slug: "why-choose-us",
        title: "Why Choose Us",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "why choose us"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 5,
        language: "en",

        seo: {
          metaTitle: "Why Choose Us",
          metaDescription:
            "A strong retail partner focused on execution, growth, and long-term success.",
          keywords: ["why choose us", "sam global"],
          focusKeyword: "Why Choose Us",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "Why Choose Us",
          ogDescription:
            "A strong retail partner focused on execution, growth, and long-term success.",
          ogImage: {},
          twitterTitle: "Why Choose Us",
          twitterDescription:
            "A strong retail partner focused on execution, growth, and long-term success.",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "why-choose-us",
            title: "Why Choose Us",
            description:
              "A strong retail partner focused on execution, growth, and long-term success.",

            image: {},
            gallery: [],
            cta: {},
            sortOrder: 1,

            points: [
              {
                title: "Proven Sales Expertise",
                description:
                  "18+ years of experience in high-volume product selling and distribution.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Proven Sales Expertise",
                  title: "Proven Sales Expertise",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 1,
              },
              {
                title: "Strong Retail Execution",
                description:
                  "Disciplined store-level execution driving performance and consistency.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Strong Retail Execution",
                  title: "Strong Retail Execution",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 2,
              },
              {
                title: "Consumer Understanding",
                description:
                  "Deep insights into Indian consumer behaviour and buying patterns.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Consumer Understanding",
                  title: "Consumer Understanding",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 3,
              },
              {
                title: "Global Brand Experience",
                description:
                  "Leadership experience with Adidas, Reebok, Levi's, Pepe Jeans, and Benetton.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Global Brand Experience",
                  title: "Global Brand Experience",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 4,
              },
              {
                title: "Structured Expansion",
                description:
                  "Planned multi-city growth strategy with scalable systems.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Structured Expansion",
                  title: "Structured Expansion",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 5,
              },
              {
                title: "Performance-Driven Approach",
                description:
                  "Focused on sell-through, inventory movement, and profitability.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Performance-Driven Approach",
                  title: "Performance-Driven Approach",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 6,
              },
              {
                title: "Financial Discipline",
                description:
                  "Strong governance and structured financial planning.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Financial Discipline",
                  title: "Financial Discipline",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 7,
              },
              {
                title: "SOP-Driven Operations",
                description:
                  "Ensuring brand compliance and operational consistency.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "SOP-Driven Operations",
                  title: "SOP-Driven Operations",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 8,
              },
              {
                title: "Long-Term Partnerships",
                description:
                  "Committed to building sustainable brand relationships.",
                image: {
                  url: "/image/png/dummy.png",
                  alt: "Long-Term Partnerships",
                  title: "Long-Term Partnerships",
                  caption: "",
                  type: "image",
                },
                cta: {},
                sortOrder: 9,
              },
            ],
          },
        ],

        metadata: {},
      },
      {
        slug: "our-mission",
        title: "Our Mission",
        pageType: "about",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description: "",
        body: "",
        excerpt: "",

        category: "about",
        tags: ["about", "mission"],

        image: {},
        gallery: [],
        points: [],
        cta: {},

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 6,
        language: "en",

        seo: {
          metaTitle: "Our Mission",
          metaDescription: "Learn about the mission of Sam Global.",
          keywords: ["our mission", "sam global"],
          focusKeyword: "Our Mission",
          canonicalUrl: "/about-us",
          robots: "index,follow",
          ogTitle: "Our Mission",
          ogDescription: "Learn about the mission of Sam Global.",
          ogImage: {},
          twitterTitle: "Our Mission",
          twitterDescription: "Learn about the mission of Sam Global.",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "About Us",
              url: "/about-us",
            },
          ],
        },

        sections: [
          {
            type: "our-mission",
            title: "Our Mission",
            description:
              "Our mission is to build a trusted digital marketplace where customers can shop with clarity and sellers can grow with confidence.<br /><br />We aim to make quality products more accessible through dependable technology, transparent service, and a customer-first approach.",

            image: {
              url: "/image/png/hand.png",
              alt: "Customer and seller support",
              title: "Our Mission",
              caption: "",
              type: "image",
            },

            gallery: [],
            points: [],
            cta: {},
            sortOrder: 1,
          },
        ],

        metadata: {
          helpSection: {
            heading1: "Shopping Made Easy",
            heading2: "Your trusted marketplace for everyday needs.",
            description:
              "Explore products, discover trusted sellers, and shop with confidence.",
            buttonText: "Shop Now",
            buttonPath: "/products",
          },
        },
      },     {
        slug: "faq-details",
        title: "Frequently Asked Questions",
        pageType: "faq",
        status: "published",
        published: true,
        publishedAt: new Date(),

        description:
          "We believe great experiences come from clarity. Here are answers to some of the most common questions to help you navigate Sam Global with ease.",

        body: "",
        excerpt: "Everything You Need To Know",

        category: "faq",
        tags: ["faq", "help", "support"],

        image: {},
        gallery: [],
        points: [],
        cta: {
          label: "Contact Support",
          url: "/contact-us",
          target: "_self",
        },

        visibility: {
          channels: [],
          roles: [],
        },

        sortOrder: 1,
        language: "en",

        seo: {
          metaTitle: "Frequently Asked Questions",
          metaDescription:
            "Find answers to common shopping, payment, shipping and account questions.",
          keywords: [
            "faq",
            "help",
            "shipping",
            "orders",
            "payments",
            "returns",
          ],
          focusKeyword: "Frequently Asked Questions",
          canonicalUrl: "/faq",
          robots: "index,follow",
          ogTitle: "Frequently Asked Questions",
          ogDescription:
            "Find answers to common shopping, payment, shipping and account questions.",
          ogImage: {},
          twitterTitle: "Frequently Asked Questions",
          twitterDescription:
            "Find answers to common shopping, payment, shipping and account questions.",
          twitterImage: {},
          schemaType: "FAQPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "FAQ",
              url: "/faq",
            },
          ],
        },

        sections: [
          {
            type: "faq-category",
            title: "Shopping & Orders",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 1,

            points: [
              {
                title: "How do I place an order?",
                description:
                  "Browse products, add them to your cart, proceed to checkout, provide your delivery details, and complete the payment.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
              {
                title: "How can I track my order?",
                description:
                  "Once your order is confirmed, tracking details will be shared with you. You can monitor the shipment using the tracking link.",
                image: {},
                cta: {},
                sortOrder: 2,
              },
              {
                title: "Can I modify or cancel my order?",
                description:
                  "Orders can be modified or cancelled only before they are dispatched. After dispatch, the return policy will apply.",
                image: {},
                cta: {},
                sortOrder: 3,
              },
            ],

            cta: {},
          },

          {
            type: "faq-category",
            title: "Shipping & Delivery",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 2,

            points: [
              {
                title: "How long does delivery take?",
                description:
                  "Delivery timelines depend on your location and product availability. Estimated delivery dates are shown during checkout.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
              {
                title: "Do you deliver everywhere?",
                description:
                  "Delivery is available only in serviceable pincodes supported by our logistics partners.",
                image: {},
                cta: {},
                sortOrder: 2,
              },
            ],

            cta: {},
          },

          {
            type: "faq-category",
            title: "Returns & Refunds",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 3,

            points: [
              {
                title: "How do I request a return?",
                description:
                  "Submit a return request from your account or contact customer support within the eligible return period.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
              {
                title: "When will I receive my refund?",
                description:
                  "Refunds are initiated after successful verification of the returned product and are credited to the original payment method.",
                image: {},
                cta: {},
                sortOrder: 2,
              },
            ],

            cta: {},
          },

          {
            type: "faq-category",
            title: "Payments",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 4,

            points: [
              {
                title: "Which payment methods are accepted?",
                description:
                  "We accept debit cards, credit cards, UPI, net banking, wallets, and other supported payment methods.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
            ],

            cta: {},
          },

          {
            type: "faq-category",
            title: "Account & Support",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 5,

            points: [
              {
                title: "How do I reset my password?",
                description:
                  "Click on 'Forgot Password' on the login page and follow the instructions sent to your registered email or mobile.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
            ],

            cta: {},
          },

          {
            type: "faq-category",
            title: "For Brands & Partners",
            description: "",
            image: {},
            gallery: [],
            sortOrder: 6,

            points: [
              {
                title: "How can I sell on Sam Global?",
                description:
                  "Visit the Become a Seller page, complete the registration process, and our team will review your application.",
                image: {},
                cta: {},
                sortOrder: 1,
              },
            ],

            cta: {},
          },

          {
            type: "need-help",
            title: "Need More Help?",
            description:
              "Get the help you need from our automated assistant or contact our support team for further assistance.",

            image: {},
            gallery: [],
            points: [],
            cta: {
              label: "Contact Support",
              url: "/contact-us",
              target: "_self",
            },
            sortOrder: 99,
          }, ],

        metadata: {},
      },
      {
        slug: "terms-of-use",
        title: "Terms of Use",
        pageType: "policy",
        status: "published",
        published: true,
        publishedAt: new Date(),
        description: "",
        body: "",
        excerpt: "",
        category: "policy",
        tags: ["terms", "policy"],
        image: {},
        gallery: [],
        points: [],
        cta: {},
        visibility: {
          channels: [],
          roles: [],
        },
        sortOrder: 1,
        language: "en",

        seo: {
          metaTitle: "Terms of Use",
          metaDescription: "",
          keywords: [],
          focusKeyword: "",
          canonicalUrl: "",
          robots: "index,follow",
          ogTitle: "Terms of Use",
          ogDescription: "",
          ogImage: {},
          twitterTitle: "",
          twitterDescription: "",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "Terms of Use",
              url: "/terms-of-use",
            },
          ],
        },

        sections: [
          {
            type: "content",
            title: "Please Read Carefully",
            description:
              "These Terms & Conditions (“Terms”) govern your access to and use of the Sam Global website, platform, and services (collectively, the “Platform”).By accessing, browsing, or using the Platform, you agree to be bound by these Terms. If you do not agree, please do not use the Platform.",
            image: {},
            gallery: [],
            sortOrder: 1,

            points: [
              {
                title: "Eligibility",
                description:
                  "You must be legally capable of entering into binding agreements to use this platform \n By using Sam Global, you confirm that all information provided is accurate and complete",
                image: {},
                cta: {},
                sortOrder: 1,
              },
              {
                title: "Eligibility",
                description:
                  "You must be legally capable of entering into binding agreements to use this platform \n By using Sam Global, you confirm that all information provided is accurate and complete",
                image: {},
                cta: {},
                sortOrder: 2,
              },

              {
                title: "Account & User Responsibility",
                description:
                  "You are responsible for maintaining the confidentiality of your account credentials.\n" +
                  "You agree not to misuse the platform or engage in fraudulent activities.\n" +
                  "Any activity carried out through your account shall be deemed your responsibility.",
                image: {},
                cta: {},
                sortOrder: 3,
              },

              {
                title: "Platform Usage",
                description:
                  "You shall use the platform only for lawful purposes\n" +
                  "You shall not attempt to disrupt, damage, or interfere with platform operations\n" +
                  "You shall not upload or transmit harmful, illegal, or objectionable content \n" +
                  "Sam Global reserves the right to suspend or terminate access for policy violations",
                image: {},
                cta: {},
                sortOrder: 4,
              },
              {
                title: "Product Information & Pricing",
                description:
                  "Product descriptions, images, and pricing are provided for informational purposes\n" +
                  "We strive for accuracy, but errors may occur \n" +
                  "Sam Global reserves the right to correct, update, or cancel orders in case of price or product errors",
                image: {},
                cta: {},
                sortOrder: 5,
              },
              {
                title: "Orders & Acceptance",
                description:
                  "Placing an order constitutes an offer to purchase\n" +
                  "Placing an order constitutes an offer to purchase\n" +
                  "Order confirmation does not guarantee acceptance where verification or availability checks are pending",
                image: {},
                cta: {},
                sortOrder: 6,
              },
              {
                title: "Payments",
                description:
                  "Payments must be made through approved payment methods\n" +
                  "Transactions are processed through secure third-party payment gateways\n" +
                  "Sam Global is not liable for payment failures arising from banks or payment service providers",
                image: {},
                cta: {},
                sortOrder: 7,
              },
              {
                title: "Shipping, Returns & Refunds",
                description:
                  "Shipping, returns, and refunds are governed by the applicable policies published on the platform\n" +
                  "By placing an order, you agree to those policy terms\n",
                image: {},
                cta: {},
                sortOrder: 8,
              },
              {
                title: "Marketplace Disclaimer",
                description:
                  "Some products may be offered by third-party sellers through the platform\n" +
                  "Sam Global may facilitate transactions but is not responsible for seller-side representations beyond applicable policy commitments\n",
                image: {},
                cta: {},
                sortOrder: 9,
              },
              {
                title: "Intellectual Property",
                description:
                  "All content, branding, graphics, designs, logos, software, and materials are owned by or licensed to Sam Global\n" +
                  "Unauthorized use, reproduction, or distribution is strictly prohibited\n",
                image: {},
                cta: {},
                sortOrder: 10,
              },
              {
                title: "Limitation of Liability",
                description:
                  "Indirect, incidental, or consequential damages\n" +
                  "Loss of profits, data, business, or goodwill\n" +
                  "Delays, interruptions, or technical failures\n" +
                  "Actions or omissions of third-party sellers, logistics providers, or 	payment gateways",
                image: {},
                cta: {},
                sortOrder: 11,
              },
              {
                title: "INDEMNITY",
                description:
                  "You agree to indemnify and hold harmless Sam Global from any claims, damages, losses, or liabilities arising from:\n" +
                  "Your use of the Platform\n" +
                  "Violation of these Terms\n" +
                  "Infringement of third-party rights\n",

                image: {},
                cta: {},
                sortOrder: 12,
              },
              {
                title: "TERMINATION",
                description:
                  "Sam Global reserves the right to:\n" +
                  "Suspend or terminate user access at any time without prior notice\n" +
                  "Remove content or restrict access in case of policy violations\n",
                image: {},
                cta: {},
                sortOrder: 13,
              },
              {
                title: "FORCE MAJEURE",
                description:
                  "Sam Global shall not be liable for failure or delay caused by events beyond reasonable control, including natural disasters, government actions, or technical disruptions.",

                image: {},
                cta: {},
                sortOrder: 14,
              },
              {
                title: "GOVERNING LAW & JURISDICTION",
                description:
                  "These Terms shall be governed by the laws of India. Any disputes shall be subject to the jurisdiction of courts located in [Insert City].",

                image: {},
                cta: {},
                sortOrder: 15,
              },
              {
                title: "MODIFICATIONS",
                description:
                  "Sam Global reserves the right to update or modify these Terms at any time Continued use of the Platform constitutes acceptance of revised Terms.",

                image: {},
                cta: {},
                sortOrder: 16,
              },
              {
                title: "CONTACT",
                description:
                  "For any queries regarding these Terms, please contact us through the Contact Us page.",

                image: {},
                cta: {},
                sortOrder: 17,
              },
            ],

            cta: {},
          },
        ],

        metadata: {},
      },

      {
        slug: "return-refund-policy",
        title: "Return & Refund Policy",
        pageType: "policy",
        status: "published",
        published: true,
        publishedAt: new Date(),
        description: "",
        body: "",
        excerpt: "",
        category: "policy",
        tags: ["return", "refund"],
        image: {},
        gallery: [],
        points: [],
        cta: {},
        visibility: {
          channels: [],
          roles: [],
        },
        sortOrder: 2,
        language: "en",

        seo: {
          metaTitle: "Return & Refund Policy",
          metaDescription: "",
          keywords: [],
          focusKeyword: "",
          canonicalUrl: "",
          robots: "index,follow",
          ogTitle: "Return & Refund Policy",
          ogDescription: "",
          ogImage: {},
          twitterTitle: "",
          twitterDescription: "",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "Return & Refund Policy",
              url: "/return-refund-policy",
            },
          ],
        },

        sections: [
          {
            type: "content",
            title: "Simple. Transparent. Hassle-Free.",
            description:
              "This Return & Refund Policy governs the conditions under which returns, exchanges, and refunds are processed.",
            image: {},
            gallery: [],
            sortOrder: 1,

            points: [
              {
                title: "Return Eligibility",
                description:
                  "Returns will be accepted only if the product is eligible under the applicable policy.\n" +
                  "The return request is initiated within the specified return window.\n" +
                  "The product is unused, undamaged, and in its original condition.\n" +
                  "Original tags, packaging, and accessories are intact.",
                image: {},
                cta: {},
                sortOrder: 1,
              },

              {
                title: "Return Process",
                description:
                  "Return requests must be raised through the appropriate platform or support channel.\n" +
                  "Once submitted, return requests will be reviewed and approved where applicable.\n" +
                  "Products must be handed over to the return courier as instructed.",
                image: {},
                cta: {},
                sortOrder: 2,
              },

              {
                title: "Verification & Approval",
                description:
                  "All returned products are subject to inspection and quality checks.\n" +
                  "Approval of return or refund is at the sole discretion of Sam Global based on product condition.",
                image: {},
                cta: {},
                sortOrder: 3,
              },

              {
                title: "Refund Process",
                description:
                  "Refunds will be initiated only after successful verification of returned products.\n" +
                  "Refunds will be processed to the original mode of payment unless otherwise specified.\n" +
                  "Timelines may vary depending on banking/payment gateway and logistics partner.",
                image: {},
                cta: {},
                sortOrder: 4,
              },

              {
                title: "Exchange Policy",
                description:
                  "Exchanges are subject to product availability and eligibility.\n" +
                  "If the requested replacement is unavailable, a refund may be issued as per policy.",
                image: {},
                cta: {},
                sortOrder: 5,
              },

              {
                title: "Non-Returnable Items",
                description:
                  "Certain products may be marked as non-returnable at the time of purchase.\n" +
                  "Personalized or hygiene-sensitive items.\n" +
                  "Products used, damaged, or returned without original condition.",
                image: {},
                cta: {},
                sortOrder: 6,
              },

              {
                title: "Damaged / Incorrect Products",
                description:
                  "Any claims regarding damaged, defective, or incorrect products must be reported within 48 hours of delivery.\n" +
                  "Photographic or video evidence may be required for claim review.",
                image: {},
                cta: {},
                sortOrder: 7,
              },

              {
                title: "Cancellation Policy",
                description:
                  "Orders can be cancelled only within the permitted cancellation window.\n" +
                  "Once dispatched, cancellation requests shall be treated under the return policy.",
                image: {},
                cta: {},
                sortOrder: 8,
              },

              {
                title: "Limitation of Liability",
                description:
                  "Sam Global shall not be liable for improper use or handling of products after delivery.\n" +
                  "Refund liability shall be limited to the value of the eligible product.\n" +
                  "Delays attributable to banks, logistics, or payment gateways are outside our control.",
                image: {},
                cta: {},
                sortOrder: 9,
              },

              {
                title: "Need Help?",
                description:
                  "For assistance, please reach out to our support team.",
                image: {},
                cta: {},
                sortOrder: 10,
              },
            ],

            cta: {},
          },
        ],

        metadata: {},
      },

      {
        slug: "shipping-delivery-policy",
        title: "Shipping & Delivery Policy",
        pageType: "policy",
        status: "published",
        published: true,
        publishedAt: new Date(),
        description: "",
        body: "",
        excerpt: "",
        category: "policy",
        tags: ["shipping", "delivery"],
        image: {},
        gallery: [],
        points: [],
        cta: {},
        visibility: {
          channels: [],
          roles: [],
        },
        sortOrder: 3,
        language: "en",

        seo: {
          metaTitle: "Shipping & Delivery Policy",
          metaDescription: "",
          keywords: [],
          focusKeyword: "",
          canonicalUrl: "",
          robots: "index,follow",
          ogTitle: "Shipping & Delivery Policy",
          ogDescription: "",
          ogImage: {},
          twitterTitle: "",
          twitterDescription: "",
          twitterImage: {},
          schemaType: "WebPage",
          schemaJson: {},
          breadcrumbs: [
            {
              label: "Home",
              url: "/",
            },
            {
              label: "Shipping & Delivery Policy",
              url: "/shipping-delivery-policy",
            },
          ],
        },

        sections: [
          {
            type: "content",
            title: "Designed for Convenience. Delivered with Care.",
            description:
              "At Sam Global, we aim to ensure a seamless delivery experience. This Shipping Policy outlines the terms governing order processing, dispatch, and delivery.",
            image: {},
            gallery: [],
            sortOrder: 1,

            points: [
              {
                title: "Order Processing",
                description:
                  "Orders are processed within standard business timelines after successful payment confirmation.\n" +
                  "Processing timelines may vary based on product availability, order volume, or operational factors.\n" +
                  "Sam Global reserves the right to cancel or delay orders in case of unforeseen circumstances, including stock unavailability or verification issues.",
                image: {},
                cta: {},
                sortOrder: 1,
              },

              {
                title: "Delivery Timelines",
                description:
                  "Estimated delivery timelines are indicative and will be displayed at checkout.\n" +
                  "Actual delivery may vary depending on location, logistics partner timelines, and external factors.\n" +
                  "Delays caused by circumstances beyond our control, including weather, strikes, regional restrictions, or logistics disruptions, shall not constitute a breach of obligation.",
                image: {},
                cta: {},
                sortOrder: 2,
              },

              {
                title: "Shipping Coverage",
                description:
                  "Delivery is subject to serviceable pincodes as determined by our logistics partners.\n" +
                  "Sam Global reserves the right to refuse delivery to certain locations without prior notice.",
                image: {},
                cta: {},
                sortOrder: 3,
              },

              {
                title: "Shipping Charges",
                description:
                  "Shipping charges, if applicable, will be displayed at checkout prior to order confirmation.\n" +
                  "Charges may vary based on order value, delivery location, product category, or promotional offers.",
                image: {},
                cta: {},
                sortOrder: 4,
              },

              {
                title: "Order Tracking",
                description:
                  "Tracking details will be shared upon dispatch of the order.\n" +
                  "The customer is responsible for monitoring shipment updates using the provided tracking information.",
                image: {},
                cta: {},
                sortOrder: 5,
              },

              {
                title: "Delivery & Acceptance",
                description:
                  "Delivery shall be deemed completed once the order is delivered to the address provided at the time of purchase.\n" +
                  "Any person available at the delivery address shall be deemed authorized to receive the order on behalf of the customer.\n" +
                  "Sam Global shall not be liable for loss or damage after successful delivery.",
                image: {},
                cta: {},
                sortOrder: 6,
              },

              {
                title: "Limitation of Liability",
                description:
                  "Sam Global shall not be liable for delays, non-delivery, or service interruptions caused by third-party logistics providers or events beyond reasonable control.",
                image: {},
                cta: {},
                sortOrder: 7,
              },

              {
                title: "Need Assistance?",
                description:
                  "For any shipping-related queries, please contact our support team.Reliable delivery, aligned with clarity and trust.",
                image: {},
                cta: {},
                sortOrder: 8,
              },
            ],
            cta: {},
          },
        ],

        metadata: {},
      },
    ];

    for (const page of pages) {
      await ContentPageModel.findOneAndUpdate({ slug: page.slug }, page, {
        new: true,
        upsert: true,
      });

      console.log(`✅ ${page.title} uploaded`);
    }

    console.log("\n🎉 All Policy Pages Seeded Successfully");

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

seedPolicyPages();
 
 
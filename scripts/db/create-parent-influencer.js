const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  ReferralService,
} = require("../../src/modules/referral/services/referral.service");

const usage = `
Create a parent influencer account

Usage:
  npm run db:create-parent-influencer -- \\
    --email parent@example.com \\
    --password 'StrongPassword@123' \\
    --first-name Parent \\
    --last-name Influencer \\
    --phone 9876543210 \\
    --code PARENT01

Required:
  --email       Influencer login email
  --password    Login password (minimum 8 characters)

Optional:
  --first-name
  --last-name
  --phone
  --code        Preferred referral code; generated when omitted
  --no-children Create the parent without permission to add children
  --help
`;

function parseArguments(argv = []) {
  const result = { canCreateChildren: true };
  const keyMap = {
    "--email": "email",
    "--password": "password",
    "--first-name": "firstName",
    "--last-name": "lastName",
    "--phone": "phone",
    "--code": "code",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument === "--no-children") {
      result.canCreateChildren = false;
      continue;
    }
    const key = keyMap[argument];
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    result[key] = value;
    index += 1;
  }

  return result;
}

function validate(payload) {
  if (!payload.email) throw new Error("--email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new Error("--email must be a valid email address");
  }
  if (!payload.password || payload.password.length < 8) {
    throw new Error("--password must contain at least 8 characters");
  }
}

async function createParentInfluencer() {
  const payload = parseArguments(process.argv.slice(2));
  if (payload.help) {
    console.log(usage.trim());
    return;
  }

  validate(payload);
  payload.email = payload.email.trim().toLowerCase();
  if (payload.code) payload.code = payload.code.trim().toUpperCase();

  await connectMongo();
  console.log("✓ Database connected");

  const service = new ReferralService();
  const influencer = await service.createParentInfluencer(payload, {
    userId: null,
    role: "system",
  });

  console.log("✓ Parent influencer created");
  console.log(`  ID: ${influencer.id || influencer._id}`);
  console.log(`  Email: ${payload.email}`);
  console.log(`  Type: ${influencer.influencerType}`);
  console.log(`  Status: ${influencer.status}`);
  console.log(`  Referral code: ${influencer.primaryCode?.code || payload.code || "generated"}`);
  console.log(`  Can create children: ${Boolean(influencer.canCreateChildren)}`);
}

createParentInfluencer()
  .catch((error) => {
    console.error(`✗ Unable to create parent influencer: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

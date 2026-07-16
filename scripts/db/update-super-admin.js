const { v4: uuidv4 } = require("uuid");
const {
  connectMongo,
  mongoose,
} = require("../../src/infrastructure/mongo/mongo-client");
const {
  sequelize,
} = require("../../src/infrastructure/sequelize/sequelize-client");
const { UserModel } = require("../../src/modules/user/models/user.model");
const { ROLES } = require("../../src/shared/constants/roles");
const { hashText } = require("../../src/shared/tools/hash");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

function makeProfile(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts.shift() || "Super";
  const lastName = parts.join(" ") || "Admin";
  return { firstName, lastName };
}

async function createOrUpdateMongoUser({
  email,
  phone,
  fullName,
  passwordHash,
}) {
  const existingUser = await UserModel.findOne({ email });
  const payload = {
    email,
    phone,
    passwordHash,
    role: ROLES.SUPER_ADMIN,
    accountStatus: "active",
    emailVerified: true,
    profile: makeProfile(fullName),
    authProviders: [],
  };

  if (existingUser) {
    existingUser.set(payload);
    await existingUser.save();
    return { user: existingUser, created: false };
  }

  const user = await UserModel.create({
    ...payload,
    refreshSessions: [],
  });

  return { user, created: true };
}

async function recreateSuperAdmin() {
  let transaction;
  let createdMongoUserId = null;
  let newMongoUserId = null;

  try {
    await connectMongo();
    await sequelize.authenticate();
    console.log("✓ Databases connected");

    console.log("\n🔐 Re-create Super Admin\n");

    const email = await question("Enter Email: ");
    const fullName = await question("Enter Full Name: ");
    const phone = await question("Enter Phone (optional): ");
    const password = await question("Enter Password: ");

    if (!email || !fullName || !password) {
      console.error("\n❌ All fields are required!");
      process.exitCode = 1;
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error("\n❌ Invalid email format!");
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashText(password);
    const { user, created } = await createOrUpdateMongoUser({
      email,
      phone: phone || undefined,
      fullName,
      passwordHash,
    });
    const userId = String(user.id);
    newMongoUserId = userId;
    createdMongoUserId = created ? userId : null;
    console.log(
      created ? "✓ Mongo auth user created" : "✓ Mongo auth user updated",
    );

    transaction = await sequelize.transaction();

    // Find old super admin
    const [oldAdmins] = await sequelize.query(
      `SELECT user_id FROM super_admins`,
      { transaction },
    );

    // Delete old related role mappings
    if (oldAdmins.length > 0) {
      for (const admin of oldAdmins) {
        await sequelize.query(
          `DELETE FROM user_roles WHERE user_id = :userId`,
          {
            replacements: { userId: admin.user_id },
            transaction,
          },
        );
      }

      await sequelize.query(`DELETE FROM super_admins`, { transaction });

      console.log("✓ Previous super admin deleted");
    }

    // Get or create super admin role
    const [roles] = await sequelize.query(
      `SELECT id FROM roles WHERE is_super_admin = true LIMIT 1`,
      { transaction },
    );

    let roleId;

    if (roles.length > 0) {
      roleId = roles[0].id;
    } else {
      roleId = uuidv4();

      await sequelize.query(
        `
        INSERT INTO roles 
        (id, name, slug, description, type, is_super_admin, active, created_at, updated_at)
        VALUES 
        (:id, 'Super Admin', 'super-admin', 'Super Admin role with all permissions', 'system', true, true, NOW(), NOW())
        `,
        {
          replacements: { id: roleId },
          transaction,
        },
      );

      console.log("✓ Super admin role created");
    }

    // Create new super admin
    await sequelize.query(
      `
      INSERT INTO super_admins 
      (id, user_id, email, full_name, is_active, created_at, updated_at)
      VALUES 
      (:id, :userId, :email, :fullName, true, NOW(), NOW())
      `,
      {
        replacements: {
          id: uuidv4(),
          userId,
          email,
          fullName,
        },
        transaction,
      },
    );

    // Assign role
    await sequelize.query(
      `
      INSERT INTO user_roles 
      (id, user_id, role_id, assigned_at)
      VALUES 
      (:id, :userId, :roleId, NOW())
      `,
      {
        replacements: {
          id: uuidv4(),
          userId,
          roleId,
        },
        transaction,
      },
    );

    await transaction.commit();
    transaction = null;

    const oldMongoUserIds = oldAdmins
      .map((admin) => admin.user_id)
      .filter(
        (oldUserId) =>
          oldUserId &&
          oldUserId !== newMongoUserId &&
          mongoose.Types.ObjectId.isValid(oldUserId),
      );
    if (oldMongoUserIds.length > 0) {
      await UserModel.updateMany(
        { _id: { $in: oldMongoUserIds }, role: ROLES.SUPER_ADMIN },
        {
          $set: {
            role: ROLES.ADMIN,
            accountStatus: "deactivated",
            refreshSessions: [],
            deactivatedAt: new Date(),
            forceLogoutAt: new Date(),
            sessionInvalidationReason: "super_admin_replaced",
          },
          $inc: {
            tokenVersion: 1,
            sessionVersion: 1,
            permissionVersion: 1,
          },
        },
      );
      console.log("✓ Previous Mongo super admin user deactivated");
    }

    console.log("\n✅ Super admin recreated successfully!");
    console.log(`Email: ${email}`);
    console.log(`User ID: ${userId}`);
    console.log(
      "Login with POST /api/v1/auth/login using this email and password.",
    );
  } catch (error) {
    if (transaction) {
      await transaction.rollback();
      transaction = null;
    }
    if (createdMongoUserId) {
      await UserModel.findByIdAndDelete(createdMongoUserId);
    }
    console.error("\n❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await sequelize.close();
    await mongoose.disconnect();
  }
}

recreateSuperAdmin();

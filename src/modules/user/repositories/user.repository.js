const { UserModel } = require("../models/user.model");

const escapeRegExp = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class UserRepository {
  async create(payload) {
    return UserModel.create(payload);
  }

  async findByEmail(email) {
    if (!email) {
      return null;
    }

    const normalizedEmail = String(email || "").trim();
    return UserModel.findOne({
      email: {
        $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i"),
      },
    });
  }
  async findUserByPhone(phone) {
    const normalized =
      String(phone || "").trim();

    const digits =
      normalized.replace(/\D/g, "");

    const localPhone =
      digits.startsWith("91") &&
        digits.length === 12
        ? digits.slice(2)
        : digits;

    return UserModel.findOne({
      $or: [
        {
          phoneNormalized: normalized,
        },
        {
          phone: normalized,
        },
        {
          phone: localPhone,
        },
        {
          phone: `91${localPhone}`,
        },
        {
          phone: `+91${localPhone}`,
        },
        {
          "authProviders.provider": "mobile_otp",
          "authProviders.providerUserId":
            normalized,
        },
      ],
    });
  }

  async markOtpIdentityVerified(
    userId,
    {
      channel,
      email,
      mobile,
    },
  ) {
    const provider =
      channel === "email"
        ? "email_otp"
        : "mobile_otp";

    const providerUserId =
      channel === "email"
        ? email
        : mobile;

    const update = {
      $addToSet: {
        authProviders: {
          provider,
          providerUserId,
        },
      },
    };

    if (channel === "email") {
      update.$set = {
        email,
        emailVerified: true,
      };
    }

    if (channel === "mobile") {
      update.$set = {
        phone: mobile,
        phoneNormalized: mobile,
        phoneVerified: true,
      };
    }

    return UserModel.findByIdAndUpdate(
      userId,
      update,
      {
        new: true,
      },
    );
  }
  async findById(userId) {
    return UserModel.findById(userId).select("-passwordHash -refreshSessions.tokenHash");
  }

  async findByProvider(provider, providerUserId) {
    return UserModel.findOne({
      authProviders: {
        $elemMatch: {
          provider,
          providerUserId,
        },
      },
    });
  }

  async findByReferralCode(referralCode) {
    return UserModel.findOne({ referralCode });
  }

  async updateById(userId, payload) {
    return UserModel.findByIdAndUpdate(userId, payload, { new: true });
  }

  async updateOne(filter, payload) {
    return UserModel.findOneAndUpdate(filter, payload, { new: true });
  }
}

module.exports = { UserRepository };

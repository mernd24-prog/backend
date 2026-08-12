module.exports = {
  id: "046-relax-seller-kyc-draft-identity",
  async up({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `
      ALTER TABLE seller_kyc
        ALTER COLUMN pan_number DROP NOT NULL,
        ALTER COLUMN legal_name DROP NOT NULL;
      `,
      { transaction },
    );
  },

  async down({ queryInterface, transaction }) {
    await queryInterface.sequelize.query(
      `
      UPDATE seller_kyc
      SET
        pan_number = COALESCE(NULLIF(pan_number, ''), 'AAAAA0000A'),
        legal_name = COALESCE(NULLIF(legal_name, ''), 'Draft Seller')
      WHERE pan_number IS NULL OR legal_name IS NULL;

      ALTER TABLE seller_kyc
        ALTER COLUMN pan_number SET NOT NULL,
        ALTER COLUMN legal_name SET NOT NULL;
      `,
      { transaction },
    );
  },
};

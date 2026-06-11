'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('tiktok_ads', 'tiktok_account_id', {
      type: Sequelize.STRING,
      allowNull: false,
    });
    await queryInterface.addColumn('tiktok_ads', 'system_id', {
      type: Sequelize.STRING
    });
  },
  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('tiktok_ads', 'tiktok_account_id');
    await queryInterface.removeColumn('tiktok_ads', 'system_id');
  }
};

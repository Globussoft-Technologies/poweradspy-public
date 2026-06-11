'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.dropTable('keyword_notifications'); 
    await queryInterface.dropTable('mail_subscriptions'); 
    await queryInterface.dropTable('tiktok_ad_country_genders'); 
    await queryInterface.dropTable('tiktok_ad_country_infos'); 
    await queryInterface.dropTable('tiktok_ad_html_landers'); 
    await queryInterface.dropTable('tiktok_ad_locations'); 
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
  }
};

'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_urls', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      ad_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'tiktok_ads',
          key: 'id'
        }
      },
      url_type: {
        type:
          Sequelize.ENUM('D','R','S','O'),
          comment:"D-Destination_url, R-Redirecting_url S-Side_column_url O-Outgoing_url"
      },
      url: {
        type:
          Sequelize.STRING
      },
      proxy_lander_status:
      {
        type:
          Sequelize.INTEGER
      },
      type:{
        type:
        Sequelize.STRING
      },
      built_with_id:{
      type:
      Sequelize.STRING
      },
      built_with_cms_id:{
      type:
      Sequelize.STRING
      },
      built_with_tracking_id:
      {
        type:
        Sequelize.STRING
        },
       built_with:
       {
        type:
        Sequelize.ENUM('Shopify','WooCommerce','Magento')
        },
        built_with_cms:
        {
          type:
        Sequelize.STRING
        },
        built_with_analytics_tracking:{
          type:
          Sequelize.STRING
        },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tiktok_ad_urls');
  }
};
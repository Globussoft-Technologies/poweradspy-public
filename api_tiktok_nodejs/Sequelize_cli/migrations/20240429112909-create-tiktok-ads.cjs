'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ads', {
      id: {
        type: Sequelize.INTEGER,
        unique: true,
        primaryKey: true,
        autoIncrement:true
      },
      ad_id: {
        type: Sequelize.STRING,
        unique: true,
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      unique_users: {
        type: Sequelize.STRING,
      },
      target_users: {
        type: Sequelize.STRING,
      },
      source: {
        type: Sequelize.STRING,
      },
      first_seen: {
        type: Sequelize.DATE,
      },
      last_seen: {
        type: Sequelize.DATE,
      },
      days_running:{
        type:Sequelize.INTEGER
      },
      post_owner_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'tiktok_ad_post_owners',
          key: 'id'
        }
      },
      language:{
        type: Sequelize.STRING
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
    await queryInterface.dropTable('tiktok_ads');
  }
};
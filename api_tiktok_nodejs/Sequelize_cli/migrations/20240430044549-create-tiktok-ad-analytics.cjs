'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_analytics', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      ad_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'tiktok_ads',
          key: 'id',
        }
      },
      likes:{
        type:Sequelize.INTEGER,
        defaultValue:0
      },
      comments:{
        type:Sequelize.INTEGER,
        defaultValue:0
      },
     shares:{
        type:Sequelize.INTEGER,
        defaultValue:0
      },
      popularity:{
        type:Sequelize.INTEGER,
        comment:"%"
        
      },
      impression :{
        type:Sequelize.INTEGER,
        
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
    await queryInterface.dropTable('tiktok_ad_analytics');
  }
};
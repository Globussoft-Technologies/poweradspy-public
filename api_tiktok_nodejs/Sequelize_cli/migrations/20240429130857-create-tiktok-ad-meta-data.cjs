'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tiktok_ad_meta_data', {
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
      video_url: {
        type: Sequelize.STRING,
      },
      video_duration: {
        type: Sequelize.STRING,
      },
      video_cover: {
        type: Sequelize.STRING,
      },
      platform: {
        type: Sequelize.INTEGER,
      },
      destination_url: {
        type: Sequelize.STRING,
      },
      source: {
        type: Sequelize.STRING,
      },
      cost: {
        type: Sequelize.FLOAT,
      },
      ctr: {
        type: Sequelize.FLOAT,
      },
      library_url: {
        type: Sequelize.STRING,
      },
      ad_paid_for: {
        type: Sequelize.STRING,
      },
      audience: {
        type: Sequelize.STRING,
      },
      interest: {
        type: Sequelize.STRING,
      },
      video_interection: {
        type: Sequelize.STRING,
      },
      creator_interactions: {
        type: Sequelize.STRING,
      },
      published_countries_count: {
        type: Sequelize.INTEGER,
      },
      target_users: {
        type: Sequelize.STRING,
      },
      top_clicks: {
        type: Sequelize.STRING,
      },
      objectives: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('objectives field must be an array');
            }
          },
        },
      },
      target_keywords: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('target_keywords field must be an array');
            }
          },
        },
      },
      top_ctr: {
        type: Sequelize.STRING,
      },
      ctr_graph: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('ctr_graph field must be an array');
            }
          },
        },
      },
      top_cvr: {
        type: Sequelize.STRING,
      },
      cvr_graph: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('cvr_graph field must be an array');
            }
          },
        },
      },
      clicks_graph: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('clicks_graph field must be an array');
            }
          },
        },
      },
      top_conversion: {
        type: Sequelize.STRING,
      },
      conversion_graph: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('conversion_graph field must be an array');
            }
          },
        },
      },
      top_remains: {
        type: Sequelize.STRING,
      },
      remain_graph: {
        type: Sequelize.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error('remain_graph field must be an array');
            }
          },
        },
      },
      affiliate_data:{
        type: Sequelize.STRING,
      },
      status:{
        type: Sequelize.STRING,
        defaultValue:0
      },
      built_with:{
        type: Sequelize.STRING
      },
      built_with_cms:{
        type: Sequelize.STRING
      },
      built_with_analytics_tracking:{
        type: Sequelize.STRING
      },  
      industry:{
        type: Sequelize.STRING
      },
      budget:{
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
    await queryInterface.dropTable('tiktok_ad_meta_data');
  }
};
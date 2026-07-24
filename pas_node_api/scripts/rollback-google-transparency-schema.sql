-- Removes only the additive Google Transparency (platform 18) tables.
-- Child table first, then the one-to-one payload table.
-- Existing google_text_* canonical tables and their rows are not dropped.

DROP TABLE IF EXISTS google_transparency_country_delivery;
DROP TABLE IF EXISTS google_transparency_ad_payload;

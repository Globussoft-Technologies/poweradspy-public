'use strict';

class ResponseFormatter {
  static success(res, data = null, message = 'Success', code = 200, meta = {}) {
    let finalData = data;
    let finalMeta = meta;
    if (data && typeof data === 'object' && !Array.isArray(data) && data.data !== undefined) {
      finalData = data.data;
      finalMeta = { ...finalMeta, ...(data.meta || {}) };
    }

    return res.status(200).json({
      code,
      message,
      data: finalData,
      meta: finalMeta,
    });
  }

  static error(res, message = 'An error occurred', code = 500, errorData = null) {
    const response = {
      code,
      message,
    };
    if (errorData) {
      response.error = errorData;
    }
    return res.status(code).json(response);
  }
}

module.exports = ResponseFormatter;

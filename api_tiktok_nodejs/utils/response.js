class Response {
  userSuccessResp(message, projectDetails) {
    return {
      statusCode: 200,
      body: {
        status: "success",
        message: message,
        data: projectDetails,
      },
    };
  }

  userFailResp(msg, err) {
    return {
      statusCode: 400,
      body: {
        status: "failed",
        message: msg,
        error: err,
      },
    };
  }

  validationFailResp(message, error) {
    return {
      statusCode: 400,
      body: {
        status: "failed",
        message: message,
        error: error,
      },
    };
  }
  searchFilterResp(message, data, totalAds) {
    return {
      statusCode: 200,
      body: {
        status: "success",
        message: message,
        totalAds,
        data,
      },
    };
  }
}

export default new Response();

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

  failResp(msg, err) {
    return this.userFailResp(msg, err);
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
  messageResp(msg){
    return {
      statusCode: 400,
      body: {
        message: msg
      }
    };
  }
    messageRespComp(msg){
    return {
      statusCode: 401,
      body: {
        message: msg
      }
    };
  }
}

export default new Response();

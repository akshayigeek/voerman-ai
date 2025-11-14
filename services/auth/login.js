require("dotenv").config();

module.exports = async (req, res, sql) => {
  const { email, password } = req?.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  const domain = process.env.DOMAIN;
  const audience = `https://${domain}/api/v2/`;
  const clientID = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  try {
    const response = await fetch(`https://${domain}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "password",
        username: email,
        password: password,
        audience: audience,
        client_id: clientID,
        client_secret: clientSecret,
        scope: "openid profile email",
      }),
    });

    if (response.status !== 200) {
      const error = await response.json();
      console.error(error);
      return res.status(403).json({
        success: false,
        message: "Forbidden",
        error,
      });
    }

    const data = await response.json();

    const userInfoResponse = await fetch(`https://${domain}/userinfo`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${data?.access_token}`,
      },
    });

    console.log("login.js 🚀🚀 55 userInfoResponse =====", userInfoResponse);

    const userInfo = await userInfoResponse.json();

    console.log("login.js 🚀🚀 52 userInfo =====", userInfo);

    res.status(200).json({
      success: true,
      message: "OK",
      data: {
        accessToken: data?.access_token,
        name: userInfo?.nickname,
        email: userInfo?.email,
        picture: userInfo?.picture,
      },
    });
  } catch (error) {
    console.log("login.js 🚀🚀 28 error =====", error);
  }
};

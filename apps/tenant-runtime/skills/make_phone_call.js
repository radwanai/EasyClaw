const https = require('https');

module.exports = {
  name: 'make_phone_call',
  description: 'Make an outbound phone call using Twilio API. Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables.',
  input_schema: {
    type: 'object',
    properties: {
      to_number: {
        type: 'string',
        description: 'Phone number to call (E.164 format, e.g. +1234567890)'
      },
      message: {
        type: 'string',
        description: 'Text message to speak via text-to-speech during the call'
      }
    },
    required: ['to_number', 'message']
  },
  
  async execute(input) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (!accountSid || !authToken || !fromNumber) {
      return {
        success: false,
        error: 'Missing Twilio credentials. Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables set up.',
        setup_instructions: 'To enable phone calls:\n1. Sign up at twilio.com\n2. Get Account SID, Auth Token, and a phone number\n3. Configure environment variables'
      };
    }
    
    // Create TwiML (Twilio Markup Language) for the call
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${input.message.replace(/[<>&'"]/g, '')}</Say>
</Response>`;
    
    const postData = new URLSearchParams({
      To: input.to_number,
      From: fromNumber,
      Twiml: twiml
    }).toString();
    
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${accountSid}/Calls.json`,
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 201) {
            const response = JSON.parse(data);
            resolve({
              success: true,
              call_sid: response.sid,
              status: response.status,
              to: response.to,
              from: response.from
            });
          } else {
            resolve({
              success: false,
              error: `Twilio API error: ${res.statusCode}`,
              details: data
            });
          }
        });
      });
      
      req.on('error', (e) => {
        resolve({
          success: false,
          error: e.message
        });
      });
      
      req.write(postData);
      req.end();
    });
  }
};

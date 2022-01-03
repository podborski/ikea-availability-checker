/**
 * Retreive the availbility of products given an iterval and send sms notification when the product
 * becomes available
 *
 *   node examples/product-sms-service.js examples/desired_items.csv
 */

const ikea = require('../source');
const errors = require('../source/lib/iows2Errors');
const fs = require('fs');
const parser = require('csv-parse');
const schedule = require('node-schedule');

// add timestamps in front of log messages
require('console-stamp')(console, 'HH:MM:ss.l');

const twilio_sid = process.env.TWILIO_SID;
const twilio_token = process.env.TWILIO_TOKEN;
const twilio_phone = process.env.TWILIO_PHONE;
const my_phone = process.env.MY_PHONE;
const store_id = 347; // East Palo Alto
const client = require('twilio')(twilio_sid, twilio_token);

const args = process.argv.slice(2);
let ikea_objects = [];


function send_sms(msg) {
  console.log('send sms with text: "' + msg + '"');

  client.messages.create({
     body: msg,
     from: twilio_phone,
     to: my_phone
   })
  .then(message => console.log(message.sid));
}

function parse_csv(csv_path, cb) {
  console.log('parse csv file: ' + csv_path);
  let idx_id = -1;
  let idx_name = -1;
  let idx_descr = -1;

  fs.createReadStream(csv_path)
  .pipe(parser.parse({delimiter: ','}))
  .on('data', function(row) {
    if(idx_id == -1 && idx_name == -1 && idx_descr == -1) {
      for(let i=0; i<row.length; i++) {
        if(row[i] === 'id') idx_id = i;
        if(row[i] === 'name') idx_name = i;
        if(row[i] === 'description') idx_descr = i;
      }
    }
    else {
      ikea_objects.push({
        'id': row[idx_id],
        'name': row[idx_name],
        'description': row[idx_descr],
        'stock': null,
        'restock': null
      });
    }
  })
  .on('end', function() {
    cb();
  })
}

async function get_availability_status() {
  for(const obj of ikea_objects) {
    try {
      const result = await ikea.availability(store_id.toString(), obj.id.toString());
      obj.stock = result.stock;
      obj.restock = result.restockDate;
    } catch (err) {
      if (err instanceof errors.IOWS2DeprecatedError) {
        console.warn(obj.name + ' ' + obj.description + ' is deprecated.');
        obj.restock = 'deprecated';
      }
    }
  }
}

function process_items() {
  console.log('process items');
  let i = 0;
  let msg = '';
  while(i<ikea_objects.length) {
    if(ikea_objects[i].restock === 'deprecated') {
      const removed = ikea_objects.splice(i, 1)[0];
      msg += removed.description + ' ' + removed.name + ' deprecated\n';
    }
    else if(ikea_objects[i].stock > 0) {
      const removed = ikea_objects.splice(i, 1)[0];
      msg += removed.description + ' ' + removed.name + ' stock=' + removed.stock + '\n';
    }
    else {
      ++i;
    }
  }
  return msg.trim();
}

const check_items = async function() {
  console.log('Check items');
  await get_availability_status();

  const msg = process_items();
  if(msg.length > 0) {
    send_sms(msg);
  }

  if(ikea_objects.length === 0) {
    console.log('DONE! No more items in desired list.');
    process.exit(0);
  }
};

(function() {
  if(args.length != 1) {
    console.error('Please only provide the path to a csv file with products');
    return;
  }

  parse_csv(args[0], function(){
    console.log('run scheduler');
    const job = schedule.scheduleJob('0 6,8,9,10,12,14,15 * * *', check_items);
  });
})();

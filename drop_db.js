const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_oAg85XMWTYyq@ep-young-sun-a8tlerv1-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

async function reset() {
  await client.connect();
  console.log('Dropping all tables...');
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public; GRANT ALL ON SCHEMA public TO neondb_owner;");
  console.log('All tables dropped.');
  await client.end();
}

reset().catch(console.error);

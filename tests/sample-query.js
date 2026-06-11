import axios from "axios";

async function run() {
  const body = {
    query: "Arcata studio one bedroom apartment condo house rental",
    minRent: 500,
    maxRent: 1000,
    minBedrooms: 0
  };
  const { data } = await axios.post("http://localhost:3010/housing/search", body, { timeout: 60000 });
  console.log(JSON.stringify(data, null, 2));
}

run().catch(e => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});

// test-critical-fixes.js — PUBCHEM_FIX_PLAN.md Fázis 5 (végleges)
import axios from "axios";

const BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

async function test(name, url, check) {
  try {
    const r = await axios.get(url, { timeout: 20000 });
    const ok = check(r.data);
    console.log(`${ok ? "✅" : "❌"} ${name}`);
    if (!ok) console.log("  Data snippet:", JSON.stringify(r.data).slice(0, 300));
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
  }
}

(async () => {
  console.log("=== PubChem MCP Server — Kritikus javítások tesztje ===\n");

  // FÁZIS 1: search_compounds — name (kisbetűs aspirin, biztonságos teszt)
  await test(
    "FÁZIS 1: search_compounds name (aspirin → CID:2244)",
    `${BASE}/compound/name/aspirin/JSON`,
    d => d.PC_Compounds?.[0]?.id?.id?.cid === 2244
  );

  // FÁZIS 1: search_compounds — formula
  await test(
    "FÁZIS 1: search_compounds formula (C9H8O4 = aspirin)",
    `${BASE}/compound/fastformula/C9H8O4/JSON`,
    d => Array.isArray(d.PC_Compounds) && d.PC_Compounds.length > 0
  );

  // FÁZIS 2: get_compound_bioactivities — Table formátum
  await test(
    "FÁZIS 2: get_compound_bioactivities (Triclosan CID:5564)",
    `${BASE}/compound/cid/5564/assaysummary/JSON`,
    d => {
      const rows = d.Table?.Row;
      return Array.isArray(rows) && rows.length > 0;
    }
  );

  // FÁZIS 3: predict_admet_properties — leírók
  await test(
    "FÁZIS 3: predict_admet_properties leírók (ivermectin CID:6321424)",
    `${BASE}/compound/cid/6321424/property/MolecularWeight,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount/JSON`,
    d => d.PropertyTable?.Properties?.[0]?.MolecularWeight > 800
  );

  // FÁZIS 4: get_safety_data — GHS heading (< 200 KB válasz)
  await test(
    "FÁZIS 4: get_safety_data GHS heading (Triclosan CID:5564)",
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/5564/JSON?heading=GHS+Classification`,
    d => {
      const text = JSON.stringify(d);
      return text.length < 200000 && d.Record != null;
    }
  );

  // FÁZIS 6: batch XLogP + TPSA ellenőrzés
  await test(
    "FÁZIS 6: batch_compound_lookup XLogP+TPSA (aspirin CID:2244 + ibuprofen CID:3672)",
    `${BASE}/compound/cid/2244,3672/property/MolecularWeight,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,IUPACName,CanonicalSMILES,InChIKey,MolecularFormula/JSON`,
    d => {
      const props = d.PropertyTable?.Properties;
      return Array.isArray(props) && props.length === 2 &&
             props[0].XLogP !== undefined && props[0].TPSA !== undefined;
    }
  );

  console.log("\n=== Teszt befejezve ===");
})();

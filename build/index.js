#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
// Type guards and validation functions
const isValidCompoundSearchArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        typeof args.query === 'string' &&
        args.query.length > 0 &&
        (args.search_type === undefined || ['name', 'smiles', 'inchi', 'sdf', 'cid', 'formula'].includes(args.search_type)) &&
        (args.max_records === undefined || (typeof args.max_records === 'number' && args.max_records > 0 && args.max_records <= 10000)));
};
const isValidCidArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        (typeof args.cid === 'number' || typeof args.cid === 'string') &&
        (args.format === undefined || ['json', 'sdf', 'xml', 'asnt', 'asnb'].includes(args.format)));
};
const isValidSmilesArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        typeof args.smiles === 'string' &&
        args.smiles.length > 0 &&
        (args.threshold === undefined || (typeof args.threshold === 'number' && args.threshold >= 0 && args.threshold <= 100)) &&
        (args.max_records === undefined || (typeof args.max_records === 'number' && args.max_records > 0 && args.max_records <= 10000)));
};
const isValidBatchArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        Array.isArray(args.cids) &&
        args.cids.length > 0 &&
        args.cids.length <= 200 &&
        args.cids.every((cid) => typeof cid === 'number' && cid > 0) &&
        (args.operation === undefined || ['property', 'synonyms', 'classification', 'description'].includes(args.operation)));
};
const isValidConformerArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        (typeof args.cid === 'number' || typeof args.cid === 'string') &&
        (args.conformer_type === undefined || ['3d', '2d'].includes(args.conformer_type)));
};
const isValidPropertiesArgs = (args) => {
    return (typeof args === 'object' &&
        args !== null &&
        (typeof args.cid === 'number' || typeof args.cid === 'string') &&
        (args.properties === undefined || (Array.isArray(args.properties) && args.properties.every((p) => typeof p === 'string'))));
};
class PubChemServer {
    server;
    apiClient;
    constructor() {
        this.server = new Server({
            name: 'pubchem-server',
            version: '1.0.0',
        }, {
            capabilities: {
                resources: {},
                tools: {},
            },
        });
        // Initialize PubChem API client
        this.apiClient = axios.create({
            baseURL: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug',
            timeout: 30000,
            headers: {
                'User-Agent': 'PubChem-MCP-Server/1.0.0',
                'Accept': 'application/json',
            },
        });
        this.setupResourceHandlers();
        this.setupToolHandlers();
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupResourceHandlers() {
        // List available resource templates
        this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
            resourceTemplates: [
                {
                    uriTemplate: 'pubchem://compound/{cid}',
                    name: 'PubChem compound entry',
                    mimeType: 'application/json',
                    description: 'Complete compound information for a PubChem CID',
                },
                {
                    uriTemplate: 'pubchem://structure/{cid}',
                    name: 'Chemical structure data',
                    mimeType: 'application/json',
                    description: '2D/3D structure information for a compound',
                },
                {
                    uriTemplate: 'pubchem://properties/{cid}',
                    name: 'Chemical properties',
                    mimeType: 'application/json',
                    description: 'Molecular properties and descriptors for a compound',
                },
                {
                    uriTemplate: 'pubchem://bioassay/{aid}',
                    name: 'PubChem bioassay data',
                    mimeType: 'application/json',
                    description: 'Bioassay information and results for an AID',
                },
                {
                    uriTemplate: 'pubchem://similarity/{smiles}',
                    name: 'Similarity search results',
                    mimeType: 'application/json',
                    description: 'Chemical similarity search results for a SMILES string',
                },
                {
                    uriTemplate: 'pubchem://safety/{cid}',
                    name: 'Safety and toxicity data',
                    mimeType: 'application/json',
                    description: 'Safety classifications and toxicity information',
                },
            ],
        }));
        // Handle resource requests
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const uri = request.params.uri;
            // Handle compound info requests
            const compoundMatch = uri.match(/^pubchem:\/\/compound\/([0-9]+)$/);
            if (compoundMatch) {
                const cid = compoundMatch[1];
                try {
                    const response = await this.apiClient.get(`/compound/cid/${cid}/JSON`);
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to fetch compound ${cid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Handle structure requests
            const structureMatch = uri.match(/^pubchem:\/\/structure\/([0-9]+)$/);
            if (structureMatch) {
                const cid = structureMatch[1];
                try {
                    const response = await this.apiClient.get(`/compound/cid/${cid}/property/CanonicalSMILES,IsomericSMILES,InChI,InChIKey/JSON`);
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to fetch structure for ${cid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Handle properties requests
            const propertiesMatch = uri.match(/^pubchem:\/\/properties\/([0-9]+)$/);
            if (propertiesMatch) {
                const cid = propertiesMatch[1];
                try {
                    const response = await this.apiClient.get(`/compound/cid/${cid}/property/MolecularWeight,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount,Complexity/JSON`);
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to fetch properties for ${cid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Handle bioassay requests
            const bioassayMatch = uri.match(/^pubchem:\/\/bioassay\/([0-9]+)$/);
            if (bioassayMatch) {
                const aid = bioassayMatch[1];
                try {
                    const response = await this.apiClient.get(`/assay/aid/${aid}/JSON`);
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to fetch bioassay ${aid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Handle similarity search requests
            const similarityMatch = uri.match(/^pubchem:\/\/similarity\/(.+)$/);
            if (similarityMatch) {
                const smiles = decodeURIComponent(similarityMatch[1]);
                try {
                    const response = await this.apiClient.post('/compound/similarity/smiles/JSON', {
                        smiles: smiles,
                        Threshold: 90,
                        MaxRecords: 100,
                    });
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to perform similarity search: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Handle safety data requests
            const safetyMatch = uri.match(/^pubchem:\/\/safety\/([0-9]+)$/);
            if (safetyMatch) {
                const cid = safetyMatch[1];
                try {
                    const response = await this.apiClient.get(`/compound/cid/${cid}/classification/JSON`);
                    return {
                        contents: [
                            {
                                uri: request.params.uri,
                                mimeType: 'application/json',
                                text: JSON.stringify(response.data, null, 2),
                            },
                        ],
                    };
                }
                catch (error) {
                    throw new McpError(ErrorCode.InternalError, `Failed to fetch safety data for ${cid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            throw new McpError(ErrorCode.InvalidRequest, `Invalid URI format: ${uri}`);
        });
    }
    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                // Chemical Search & Retrieval (6 tools)
                {
                    name: 'search_compounds',
                    description: 'Search PubChem database for compounds by name, CAS number, formula, or identifier',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query (compound name, CAS, formula, or identifier)' },
                            search_type: { type: 'string', enum: ['name', 'smiles', 'inchi', 'sdf', 'cid', 'formula'], description: 'Type of search to perform (default: name)' },
                            max_records: { type: 'number', description: 'Maximum number of results (1-10000, default: 100)', minimum: 1, maximum: 10000 },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'get_compound_info',
                    description: 'Get detailed information for a specific compound by PubChem CID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            format: { type: 'string', enum: ['json', 'sdf', 'xml', 'asnt', 'asnb'], description: 'Output format (default: json)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'search_by_smiles',
                    description: 'Search for compounds by SMILES string (exact match)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            smiles: { type: 'string', description: 'SMILES string of the query molecule' },
                        },
                        required: ['smiles'],
                    },
                },
                {
                    name: 'search_by_inchi',
                    description: 'Search for compounds by InChI or InChI key',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            inchi: { type: 'string', description: 'InChI string or InChI key' },
                        },
                        required: ['inchi'],
                    },
                },
                {
                    name: 'search_by_cas_number',
                    description: 'Search for compounds by CAS Registry Number',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cas_number: { type: 'string', description: 'CAS Registry Number (e.g., 50-78-2)' },
                        },
                        required: ['cas_number'],
                    },
                },
                {
                    name: 'get_compound_synonyms',
                    description: 'Get all names and synonyms for a compound',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                // Structure Analysis & Similarity (5 tools)
                {
                    name: 'search_similar_compounds',
                    description: 'Find chemically similar compounds using Tanimoto similarity',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            smiles: { type: 'string', description: 'SMILES string of the query molecule' },
                            threshold: { type: 'number', description: 'Similarity threshold (0-100, default: 90)', minimum: 0, maximum: 100 },
                            max_records: { type: 'number', description: 'Maximum number of results (1-10000, default: 100)', minimum: 1, maximum: 10000 },
                        },
                        required: ['smiles'],
                    },
                },
                {
                    name: 'substructure_search',
                    description: 'Find compounds containing a specific substructure',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            smiles: { type: 'string', description: 'SMILES string of the substructure query' },
                            max_records: { type: 'number', description: 'Maximum number of results (1-10000, default: 100)', minimum: 1, maximum: 10000 },
                        },
                        required: ['smiles'],
                    },
                },
                {
                    name: 'superstructure_search',
                    description: 'Find larger compounds that contain the query structure',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            smiles: { type: 'string', description: 'SMILES string of the query structure' },
                            max_records: { type: 'number', description: 'Maximum number of results (1-10000, default: 100)', minimum: 1, maximum: 10000 },
                        },
                        required: ['smiles'],
                    },
                },
                {
                    name: 'get_3d_conformers',
                    description: 'Get 3D conformer data and structural information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            conformer_type: { type: 'string', enum: ['3d', '2d'], description: 'Type of conformer data (default: 3d)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'analyze_stereochemistry',
                    description: 'Analyze stereochemistry, chirality, and isomer information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                // Chemical Properties & Descriptors (6 tools)
                {
                    name: 'get_compound_properties',
                    description: 'Get molecular properties (MW, logP, TPSA, etc.)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            properties: { type: 'array', items: { type: 'string' }, description: 'Specific properties to retrieve (optional)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'calculate_descriptors',
                    description: 'Calculate comprehensive molecular descriptors and fingerprints',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            descriptor_type: { type: 'string', enum: ['all', 'basic', 'topological', '3d'], description: 'Type of descriptors (default: all)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'predict_admet_properties',
                    description: 'Predict ADMET properties (Absorption, Distribution, Metabolism, Excretion, Toxicity)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            smiles: { type: 'string', description: 'SMILES string (alternative to CID)' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'assess_drug_likeness',
                    description: 'Assess drug-likeness using Lipinski Rule of Five, Veber rules, and PAINS filters',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            smiles: { type: 'string', description: 'SMILES string (alternative to CID)' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'analyze_molecular_complexity',
                    description: 'Analyze molecular complexity and synthetic accessibility',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'get_pharmacophore_features',
                    description: 'Get pharmacophore features and binding site information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                // Bioassay & Activity Data (5 tools)
                {
                    name: 'search_bioassays',
                    description: 'Search for biological assays by target, description, or source',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'General search query' },
                            target: { type: 'string', description: 'Target protein or gene name' },
                            source: { type: 'string', description: 'Data source (e.g., ChEMBL, NCGC)' },
                            max_records: { type: 'number', description: 'Maximum number of results (1-1000, default: 100)', minimum: 1, maximum: 1000 },
                        },
                        required: [],
                    },
                },
                {
                    name: 'get_assay_info',
                    description: 'Get detailed information for a specific bioassay by AID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            aid: { type: 'number', description: 'PubChem Assay ID (AID)' },
                        },
                        required: ['aid'],
                    },
                },
                {
                    name: 'get_compound_bioactivities',
                    description: 'Get all bioassay results and activities for a compound',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            activity_outcome: { type: 'string', enum: ['active', 'inactive', 'inconclusive', 'all'], description: 'Filter by activity outcome (default: all)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'search_by_target',
                    description: 'Find compounds tested against a specific biological target',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            target: { type: 'string', description: 'Target name (gene, protein, or pathway)' },
                            activity_type: { type: 'string', description: 'Type of activity (e.g., IC50, EC50, Ki)' },
                            max_records: { type: 'number', description: 'Maximum number of results (1-1000, default: 100)', minimum: 1, maximum: 1000 },
                        },
                        required: ['target'],
                    },
                },
                {
                    name: 'compare_activity_profiles',
                    description: 'Compare bioactivity profiles across multiple compounds',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cids: { type: 'array', items: { type: 'number' }, description: 'Array of PubChem CIDs (2-50)', minItems: 2, maxItems: 50 },
                            activity_type: { type: 'string', description: 'Specific activity type for comparison (optional)' },
                        },
                        required: ['cids'],
                    },
                },
                // Safety & Toxicity (4 tools)
                {
                    name: 'get_safety_data',
                    description: 'Get GHS hazard classifications and safety information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'get_toxicity_info',
                    description: 'Get toxicity data including LD50, carcinogenicity, and mutagenicity',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'assess_environmental_fate',
                    description: 'Assess environmental fate including biodegradation and bioaccumulation',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'get_regulatory_info',
                    description: 'Get regulatory information from FDA, EPA, and international agencies',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                // Cross-References & Integration (4 tools)
                {
                    name: 'get_external_references',
                    description: 'Get links to external databases (ChEMBL, DrugBank, KEGG, etc.)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'search_patents',
                    description: 'Search for chemical patents and intellectual property information',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                            query: { type: 'string', description: 'Patent search query (alternative to CID)' },
                        },
                        required: [],
                    },
                },
                {
                    name: 'get_literature_references',
                    description: 'Get PubMed citations and scientific literature references',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cid: { type: ['number', 'string'], description: 'PubChem Compound ID (CID)' },
                        },
                        required: ['cid'],
                    },
                },
                {
                    name: 'batch_compound_lookup',
                    description: 'Process multiple compound IDs efficiently',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            cids: { type: 'array', items: { type: 'number' }, description: 'Array of PubChem CIDs (1-200)', minItems: 1, maxItems: 200 },
                            operation: { type: 'string', enum: ['property', 'synonyms', 'classification', 'description'], description: 'Operation to perform (default: property)' },
                        },
                        required: ['cids'],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    // Chemical Search & Retrieval
                    case 'search_compounds':
                        return await this.handleSearchCompounds(args);
                    case 'get_compound_info':
                        return await this.handleGetCompoundInfo(args);
                    case 'search_by_smiles':
                        return await this.handleSearchBySmiles(args);
                    case 'search_by_inchi':
                        return await this.handleSearchByInchi(args);
                    case 'search_by_cas_number':
                        return await this.handleSearchByCasNumber(args);
                    case 'get_compound_synonyms':
                        return await this.handleGetCompoundSynonyms(args);
                    // Structure Analysis & Similarity
                    case 'search_similar_compounds':
                        return await this.handleSearchSimilarCompounds(args);
                    case 'substructure_search':
                        return await this.handleSubstructureSearch(args);
                    case 'superstructure_search':
                        return await this.handleSuperstructureSearch(args);
                    case 'get_3d_conformers':
                        return await this.handleGet3dConformers(args);
                    case 'analyze_stereochemistry':
                        return await this.handleAnalyzeStereochemistry(args);
                    // Chemical Properties & Descriptors
                    case 'get_compound_properties':
                        return await this.handleGetCompoundProperties(args);
                    case 'calculate_descriptors':
                        return await this.handleCalculateDescriptors(args);
                    case 'predict_admet_properties':
                        return await this.handlePredictAdmetProperties(args);
                    case 'assess_drug_likeness':
                        return await this.handleAssessDrugLikeness(args);
                    case 'analyze_molecular_complexity':
                        return await this.handleAnalyzeMolecularComplexity(args);
                    case 'get_pharmacophore_features':
                        return await this.handleGetPharmacophoreFeatures(args);
                    // Bioassay & Activity Data
                    case 'search_bioassays':
                        return await this.handleSearchBioassays(args);
                    case 'get_assay_info':
                        return await this.handleGetAssayInfo(args);
                    case 'get_compound_bioactivities':
                        return await this.handleGetCompoundBioactivities(args);
                    case 'search_by_target':
                        return await this.handleSearchByTarget(args);
                    case 'compare_activity_profiles':
                        return await this.handleCompareActivityProfiles(args);
                    // Safety & Toxicity
                    case 'get_safety_data':
                        return await this.handleGetSafetyData(args);
                    case 'get_toxicity_info':
                        return await this.handleGetToxicityInfo(args);
                    case 'assess_environmental_fate':
                        return await this.handleAssessEnvironmentalFate(args);
                    case 'get_regulatory_info':
                        return await this.handleGetRegulatoryInfo(args);
                    // Cross-References & Integration
                    case 'get_external_references':
                        return await this.handleGetExternalReferences(args);
                    case 'search_patents':
                        return await this.handleSearchPatents(args);
                    case 'get_literature_references':
                        return await this.handleGetLiteratureReferences(args);
                    case 'batch_compound_lookup':
                        return await this.handleBatchCompoundLookup(args);
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing tool ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    // Chemical Search & Retrieval handlers
    // PHASE 1 — search_compounds fixed: correct PUG REST endpoints + PC_Compounds processing
    async handleSearchCompounds(args) {
        if (!isValidCompoundSearchArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid compound search arguments');
        }
        const query = args.query;
        const searchType = args.search_type || 'name';
        const maxRecords = args.max_records || 10;
        if (!query)
            throw new McpError(ErrorCode.InvalidParams, "The 'query' parameter is required.");
        const encoded = encodeURIComponent(query);
        // Formula search: PubChem async ListKey protocol
        if (searchType === 'formula') {
            let cids = [];
            try {
                // Step 1: initiate search → Waiting.ListKey
                const r1 = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/formula/${encoded}/JSON`, { timeout: 15000 });
                const listKey = r1.data?.Waiting?.ListKey;
                if (!listKey) {
                    // Rare: immediate result (CIDList)
                    cids = r1.data?.IdentifierList?.CID ?? [];
                }
                else {
                    // Step 2: polling (max 3 attempts, 3 s apart)
                    for (let attempt = 0; attempt < 3; attempt++) {
                        await new Promise(res => setTimeout(res, 3000));
                        try {
                            const r2 = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/listkey/${listKey}/cids/JSON`, { timeout: 10000 });
                            if (r2.data?.IdentifierList?.CID) {
                                cids = r2.data.IdentifierList.CID;
                                break;
                            }
                        }
                        catch (_) { /* még fut */ }
                    }
                }
            }
            catch (err) {
                if (err.response?.status === 404) {
                    return { content: [{ type: 'text', text: JSON.stringify({ query, search_type: searchType, result_count: 0, compounds: [], message: `No compound found for: "${query}"` }) }] };
                }
                throw new McpError(ErrorCode.InternalError, `Failed formula search: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
            if (cids.length === 0) {
                return { content: [{ type: 'text', text: JSON.stringify({ query, search_type: searchType, result_count: 0, compounds: [], message: `No compound found for formula: "${query}"` }) }] };
            }
            // Property fetch a top N CID-hez
            const topCids = cids.slice(0, maxRecords);
            const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${topCids.join(',')}/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES,InChIKey,XLogP/JSON`;
            const propResp = await axios.get(propUrl, { timeout: 15000 });
            const propList = propResp.data?.PropertyTable?.Properties ?? [];
            const compounds = propList.map(p => ({
                cid: p.CID ?? null,
                iupac_name: p.IUPACName ?? null,
                molecular_formula: p.MolecularFormula ?? null,
                molecular_weight: p.MolecularWeight ?? null,
                smiles: p.CanonicalSMILES ?? null,
                inchikey: p.InChIKey ?? null,
            }));
            return {
                content: [{ type: 'text', text: JSON.stringify({ query, search_type: searchType, total_found: cids.length, result_count: compounds.length, compounds }) }]
            };
        }
        // name / synonym / cas search: PC_Compounds JSON
        let rawData;
        try {
            const response = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/JSON`, { timeout: 15000 });
            rawData = response.data;
        }
        catch (err) {
            if (err.response?.status === 404) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                query, search_type: searchType, result_count: 0, compounds: [],
                                message: `No compound found: "${query}"`
                            })
                        }]
                };
            }
            throw new McpError(ErrorCode.InternalError, `Failed to search compounds: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        // PC_Compounds tömb feldolgozása
        const compounds = (rawData?.PC_Compounds ?? []).slice(0, maxRecords).map((c) => {
            const cid = c.id?.id?.cid ?? null;
            const props = {};
            for (const p of c.props ?? []) {
                const label = p.urn?.label;
                const pname = p.urn?.name;
                const key = pname ? `${label}_${pname}` : label;
                const val = p.value?.sval ?? p.value?.fval ?? p.value?.ival ?? null;
                if (key && val !== null)
                    props[key] = val;
            }
            return {
                cid,
                iupac_name: props['IUPAC Name_Preferred'] ?? props['IUPAC Name_Traditional'] ?? null,
                molecular_formula: props['Molecular Formula'] ?? null,
                molecular_weight: props['Molecular Weight'] ?? null,
                smiles: props['SMILES_Canonical'] ?? props['SMILES_Isomeric'] ?? null,
                inchikey: props['InChIKey_Standard'] ?? null,
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ query, search_type: searchType, result_count: compounds.length, compounds })
                }]
        };
    }
    async handleGetCompoundInfo(args) {
        if (!isValidCidArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid CID arguments');
        }
        try {
            const format = args.format || 'json';
            const response = await this.apiClient.get(`/compound/cid/${args.cid}/${format === 'json' ? 'JSON' : format}`);
            return {
                content: [
                    {
                        type: 'text',
                        text: format === 'json' ? JSON.stringify(response.data, null, 2) : String(response.data),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to get compound info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleSearchBySmiles(args) {
        if (!isValidSmilesArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid SMILES arguments');
        }
        try {
            const response = await this.apiClient.get(`/compound/smiles/${encodeURIComponent(args.smiles)}/cids/JSON`);
            if (response.data?.IdentifierList?.CID?.length > 0) {
                const cid = response.data.IdentifierList.CID[0];
                const detailsResponse = await this.apiClient.get(`/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                query_smiles: args.smiles,
                                found_cid: cid,
                                details: detailsResponse.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ message: 'No exact match found', query_smiles: args.smiles }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to search by SMILES: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    // Simplified implementation handlers (placeholder implementations)
    async handleSearchByInchi(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'InChI search not yet implemented', args }, null, 2) }] };
    }
    async handleSearchByCasNumber(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'CAS search not yet implemented', args }, null, 2) }] };
    }
    async handleGetCompoundSynonyms(args) {
        if (!isValidCidArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid CID arguments');
        }
        try {
            const response = await this.apiClient.get(`/compound/cid/${args.cid}/synonyms/JSON`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to get compound synonyms: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleSearchSimilarCompounds(args) {
        if (!isValidSmilesArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid similarity search arguments');
        }
        try {
            const threshold = args.threshold || 90;
            const maxRecords = args.max_records || 100;
            const response = await this.apiClient.post('/compound/similarity/smiles/JSON', {
                smiles: args.smiles,
                Threshold: threshold,
                MaxRecords: maxRecords,
            });
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to search similar compounds: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleSubstructureSearch(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Substructure search not yet implemented', args }, null, 2) }] };
    }
    async handleSuperstructureSearch(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Superstructure search not yet implemented', args }, null, 2) }] };
    }
    async handleGet3dConformers(args) {
        if (!isValidConformerArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid 3D conformer arguments');
        }
        try {
            const response = await this.apiClient.get(`/compound/cid/${args.cid}/property/Volume3D,ConformerCount3D/JSON`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            cid: args.cid,
                            conformer_type: args.conformer_type || '3d',
                            properties: response.data,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to get 3D conformers: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleAnalyzeStereochemistry(args) {
        if (!isValidCidArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid stereochemistry arguments');
        }
        try {
            const response = await this.apiClient.get(`/compound/cid/${args.cid}/property/AtomStereoCount,DefinedAtomStereoCount,BondStereoCount,DefinedBondStereoCount,IsomericSMILES/JSON`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            cid: args.cid,
                            stereochemistry: response.data,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to analyze stereochemistry: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleGetCompoundProperties(args) {
        if (!isValidPropertiesArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid compound properties arguments');
        }
        try {
            const properties = args.properties || [
                'MolecularWeight', 'XLogP', 'TPSA', 'HBondDonorCount', 'HBondAcceptorCount',
                'RotatableBondCount', 'Complexity', 'HeavyAtomCount', 'Charge'
            ];
            const response = await this.apiClient.get(`/compound/cid/${args.cid}/property/${properties.join(',')}/JSON`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to get compound properties: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    // Placeholder implementations for remaining methods
    async handleCalculateDescriptors(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Descriptor calculation not yet implemented', args }, null, 2) }] };
    }
    // PHASE 3 — predict_admet_properties: PubChem descriptors + QSAR models
    async handlePredictAdmetProperties(args) {
        const typedArgs = args;
        const cid = Number(typedArgs.cid);
        if (!cid)
            throw new McpError(ErrorCode.InvalidParams, "The 'cid' parameter is required.");
        const propUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/` +
            `MolecularWeight,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,` +
            `RotatableBondCount,HeavyAtomCount,Complexity,MolecularFormula/JSON`;
        let propData;
        try {
            const response = await axios.get(propUrl, { timeout: 15000 });
            propData = response.data;
        }
        catch (err) {
            if (err.response?.status === 404)
                throw new McpError(ErrorCode.InvalidParams, `CID ${cid} not found.`);
            throw new McpError(ErrorCode.InternalError, `Failed to fetch descriptors: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        const p = propData?.PropertyTable?.Properties?.[0];
        if (!p)
            throw new McpError(ErrorCode.InternalError, 'Failed to retrieve molecular descriptors.');
        const mw = p.MolecularWeight ?? 0;
        const logP = p.XLogP ?? 0;
        const tpsa = p.TPSA ?? 0;
        const hbd = p.HBondDonorCount ?? 0;
        const hba = p.HBondAcceptorCount ?? 0;
        const rotB = p.RotatableBondCount ?? 0;
        const heavy = p.HeavyAtomCount ?? 0;
        const cmplx = p.Complexity ?? 0;
        // Lipinski Ro5
        const ro5v = [mw > 500, logP > 5, hbd > 5, hba > 10].filter(Boolean).length;
        // Clark (1999) BBB modell
        const logBB = 0.152 * logP - 0.0148 * tpsa + 0.139;
        const bbb = logBB > 0.3 ? 'high' : logBB > -1.0 ? 'moderate' : 'low';
        // PPB heurisztika
        const ppb = (logP > 3 && tpsa < 80) ? '>90%' :
            (logP > 1 && tpsa < 120) ? '70-90%' : '<70%';
        // BCS osztályozás
        const highPerm = tpsa <= 75 && hbd <= 3;
        const highSol = logP < 3 && mw <= 500;
        const bcs = highPerm && highSol ? 'I' :
            highPerm && !highSol ? 'II' :
                !highPerm && highSol ? 'III' : 'IV';
        // SA score approximation
        const sa = heavy <= 20 && rotB <= 5 ? 'low' :
            heavy <= 35 && cmplx < 500 ? 'medium' :
                heavy > 35 || cmplx > 1000 ? 'high' : 'medium-high';
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        cid,
                        input_descriptors: { mw, logP, tpsa, hbd, hba, rotB, heavy, cmplx },
                        druglikeness: {
                            lipinski_ro5_pass: ro5v <= 1,
                            ro5_violations: ro5v,
                            veber_pass: rotB <= 10 && tpsa <= 140,
                            egan_gi_absorption: tpsa <= 131.6 && logP <= 5.88,
                        },
                        admet_predictions: {
                            oral_absorption: (tpsa <= 131.6 && logP <= 5.88) ? 'high' : 'low',
                            bcs_class: bcs,
                            bbb_penetration: bbb,
                            logBB_estimate: parseFloat(logBB.toFixed(3)),
                            plasma_protein_binding: ppb,
                            cyp_inhibition_risk: (logP > 3 && mw > 300 && mw < 600) ? 'moderate-high' : 'low-moderate',
                            pgp_substrate_likely: mw > 400 && (hbd + hba) > 8,
                        },
                        synthetic_accessibility: sa,
                        disclaimer: 'QSAR model-based estimates — NOT experimental data. ' +
                            'Validated measurements are required for clinical decisions. ' +
                            'Recommended tools: pkCSM, SwissADME, ADMETlab 3.0.'
                    })
                }]
        };
    }
    async handleAssessDrugLikeness(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Drug-likeness assessment not yet implemented', args }, null, 2) }] };
    }
    async handleAnalyzeMolecularComplexity(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Molecular complexity analysis not yet implemented', args }, null, 2) }] };
    }
    async handleGetPharmacophoreFeatures(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Pharmacophore features not yet implemented', args }, null, 2) }] };
    }
    async handleSearchBioassays(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Bioassay search not yet implemented', args }, null, 2) }] };
    }
    async handleGetAssayInfo(args) {
        try {
            const response = await this.apiClient.get(`/assay/aid/${args.aid}/JSON`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to get assay info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    // PHASE 2 — get_compound_bioactivities: /assaysummary/JSON endpoint
    // Real PubChem response format: Table.Row[].Cell[] (indexed columns)
    // Columns: AID(0), PanelMemberID(1), SID(2), CID(3), ActivityOutcome(4),
    //          TargetAccession(5), TargetGeneID(6), ActivityValue[uM](7),
    //          ActivityName(8), AssayName(9), AssayType(10), PubMedID(11), RNAi(12)
    async handleGetCompoundBioactivities(args) {
        const typedArgs = args;
        const cid = Number(typedArgs.cid);
        if (!cid)
            throw new McpError(ErrorCode.InvalidParams, "The 'cid' parameter is required.");
        const activityOutcome = typedArgs.activity_outcome;
        const maxRecords = Number(typedArgs.max_records ?? 50);
        const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/assaysummary/JSON`;
        let rawData;
        try {
            const response = await axios.get(url, { timeout: 20000 });
            rawData = response.data;
        }
        catch (err) {
            if (err.response?.status === 404) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({ cid, activities: [], message: 'No bioassay data found for this CID.' })
                        }]
                };
            }
            throw new McpError(ErrorCode.InternalError, `Failed to get bioactivities: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        // A PubChem Table formátumú választ dolgozzuk fel
        const table = rawData?.Table;
        const cols = table?.Columns?.Column ?? [];
        const rows = table?.Row ?? [];
        // Oszlop index meghatározása
        const idx = (name) => cols.indexOf(name);
        const AID_I = idx('AID');
        const OUTCOME_I = idx('Activity Outcome');
        const ACT_VAL_I = idx('Activity Value [uM]');
        const ACT_NAME_I = idx('Activity Name');
        const ASSAY_I = idx('Assay Name');
        const ASSAY_TYPE_I = idx('Assay Type');
        const TARGET_ACC_I = idx('Target Accession');
        const TARGET_GENE_I = idx('Target GeneID');
        // Map all rows to structured objects
        const allActivities = rows.map((r) => {
            const cell = r.Cell ?? [];
            return {
                aid: cell[AID_I] ?? null,
                outcome: cell[OUTCOME_I] ?? null,
                activity_value: cell[ACT_VAL_I] || null,
                activity_type: cell[ACT_NAME_I] || null,
                assay_name: cell[ASSAY_I] || null,
                assay_type: cell[ASSAY_TYPE_I] || null,
                target_accession: cell[TARGET_ACC_I] || null,
                target_gene_id: cell[TARGET_GENE_I] || null,
            };
        });
        // Outcome distribution
        const stats = {};
        for (const a of allActivities) {
            const o = a.outcome ?? 'unknown';
            stats[o] = (stats[o] ?? 0) + 1;
        }
        // Optional filter by activity_outcome
        let filtered = allActivities;
        if (activityOutcome && activityOutcome !== 'all') {
            const f = activityOutcome.toLowerCase();
            filtered = allActivities.filter(a => a.outcome?.toLowerCase() === f);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        cid,
                        total_assays: allActivities.length,
                        filtered_count: filtered.length,
                        outcome_distribution: stats,
                        activities: filtered.slice(0, maxRecords)
                    })
                }]
        };
    }
    async handleSearchByTarget(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Target search not yet implemented', args }, null, 2) }] };
    }
    async handleCompareActivityProfiles(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Activity profile comparison not yet implemented', args }, null, 2) }] };
    }
    // PHASE 4 — get_safety_data fixed: ?heading=GHS+Classification (not the full TOC)
    async handleGetSafetyData(args) {
        if (!isValidCidArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid CID arguments');
        }
        const cid = Number(args.cid);
        // 1. Kísérlet: GHS Classification heading (legpontosabb, <50 KB)
        let ghsData = null;
        try {
            const r = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`, { timeout: 15000 });
            ghsData = r.data;
        }
        catch (err) {
            if (err.response?.status !== 404)
                throw new McpError(ErrorCode.InternalError, `Failed to get safety data: ${err instanceof Error ? err.message : 'Unknown error'}`);
            // 404 → try fallback heading
        }
        // 2. Fallback: Safety and Hazards heading
        if (!ghsData) {
            try {
                const r = await axios.get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Safety+and+Hazards`, { timeout: 15000 });
                ghsData = r.data;
            }
            catch (err) {
                if (err.response?.status !== 404)
                    throw new McpError(ErrorCode.InternalError, `Failed to get safety data: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }
        if (!ghsData) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            cid,
                            ghs_available: false,
                            message: 'No GHS safety data found for this compound.'
                        })
                    }]
            };
        }
        // Struktúrált GHS mezők kinyerése
        const result = {
            cid,
            ghs_available: true,
            signal_word: null,
            pictograms: [],
            hazard_statements: [], // H-mondatok
            precautionary_statements: [], // P-mondatok
            ghs_sources: [],
        };
        function extractSections(sections) {
            for (const section of sections ?? []) {
                for (const info of section.Information ?? []) {
                    for (const val of info.Value?.StringWithMarkup ?? []) {
                        const str = val.String ?? '';
                        if (/danger|warning|veszély|figyelmeztetés/i.test(str)) {
                            result.signal_word = str;
                        }
                        else if (/^H\d{3}/.test(str) && !result.hazard_statements.includes(str)) {
                            result.hazard_statements.push(str);
                        }
                        else if (/^P\d{3}/.test(str) && !result.precautionary_statements.includes(str)) {
                            result.precautionary_statements.push(str);
                        }
                        else if (/GHS\d{2}/i.test(str) && !result.pictograms.includes(str)) {
                            result.pictograms.push(str);
                        }
                    }
                    if (info.Name && !result.ghs_sources.includes(info.Name)) {
                        result.ghs_sources.push(info.Name);
                    }
                }
                if (section.Section)
                    extractSections(section.Section);
            }
        }
        extractSections(ghsData?.Record?.Section ?? []);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result)
                }]
        };
    }
    async handleGetToxicityInfo(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Toxicity info not yet implemented', args }, null, 2) }] };
    }
    async handleAssessEnvironmentalFate(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Environmental fate assessment not yet implemented', args }, null, 2) }] };
    }
    async handleGetRegulatoryInfo(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Regulatory info not yet implemented', args }, null, 2) }] };
    }
    async handleGetExternalReferences(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'External references not yet implemented', args }, null, 2) }] };
    }
    async handleSearchPatents(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Patent search not yet implemented', args }, null, 2) }] };
    }
    async handleGetLiteratureReferences(args) {
        return { content: [{ type: 'text', text: JSON.stringify({ message: 'Literature references not yet implemented', args }, null, 2) }] };
    }
    // PHASE 6 — batch_compound_lookup: XLogP and TPSA added to property list
    async handleBatchCompoundLookup(args) {
        if (!isValidBatchArgs(args)) {
            throw new McpError(ErrorCode.InvalidParams, 'Invalid batch arguments');
        }
        try {
            const operation = args.operation || 'property';
            const cids = args.cids.slice(0, 200);
            if (operation === 'property') {
                // Batch property fetch — single API call for all CIDs
                const BATCH_PROPS = [
                    'MolecularWeight', 'XLogP', 'TPSA', 'HBondDonorCount',
                    'HBondAcceptorCount', 'RotatableBondCount', 'IUPACName',
                    'CanonicalSMILES', 'InChIKey', 'MolecularFormula'
                ].join(',');
                const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cids.join(',')}/property/${BATCH_PROPS}/JSON`;
                const response = await axios.get(url, { timeout: 30000 });
                return { content: [{ type: 'text', text: JSON.stringify({ operation, cid_count: cids.length, data: response.data }, null, 2) }] };
            }
            // Other operations (synonyms, classification, description) — one by one
            const results = [];
            for (const cid of cids.slice(0, 10)) {
                try {
                    const response = await this.apiClient.get(`/compound/cid/${cid}/${operation}/JSON`);
                    results.push({ cid, data: response.data, success: true });
                }
                catch (error) {
                    results.push({ cid, error: error instanceof Error ? error.message : 'Unknown error', success: false });
                }
            }
            return { content: [{ type: 'text', text: JSON.stringify({ operation, batch_results: results }, null, 2) }] };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Batch lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('PubChem MCP server running on stdio');
    }
}
const server = new PubChemServer();
server.run().catch(console.error);
//# sourceMappingURL=index.js.map
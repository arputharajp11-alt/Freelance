/**
 * FreelancerHub - Truffle Configuration
 * 
 * This file links the project to Ganache so contract and event data
 * can be viewed in the Ganache UI.
 * 
 * To add this workspace in Ganache:
 *   1. Open Ganache → Settings (gear icon)
 *   2. Go to "WORKSPACE" tab
 *   3. Under "TRUFFLE PROJECTS", click "ADD PROJECT"
 *   4. Select this truffle-config.js file
 *   5. Click "SAVE AND RESTART"
 */

module.exports = {
    /**
     * Networks define how you connect to your ethereum client.
     * Ganache runs on localhost:7545 by default.
     */
    networks: {
        // Development network - Ganache
        development: {
            host: "127.0.0.1",
            port: 7545,
            network_id: "5777",   // Ganache default network ID
        },
    },

    /**
     * Compiler settings for the FreelancerEscrow contract
     */
    compilers: {
        solc: {
            version: "0.8.19",
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            }
        }
    },

    /**
     * Contract build directory - where compiled artifacts are stored
     */
    contracts_build_directory: "./build",

    /**
     * Contracts source directory
     */
    contracts_directory: "./contracts",

    /**
     * Migrations directory
     */
    migrations_directory: "./migrations",
};

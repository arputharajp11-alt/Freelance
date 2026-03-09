const FreelancerEscrow = artifacts.require("FreelancerEscrow");

module.exports = function (deployer) {
    deployer.deploy(FreelancerEscrow);
};

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title FreelancerHub Escrow Contract
 * @dev Handles escrow payments between clients and freelancers
 * @notice This contract locks funds when a project is accepted,
 *         releases to freelancer on completion, or refunds to client on dispute
 */
contract FreelancerEscrow {
    
    enum ProjectState { 
        Created,        // 0 - Project created, funds locked
        Active,         // 1 - Freelancer accepted, work in progress
        Submitted,      // 2 - Freelancer submitted work
        Completed,      // 3 - Client approved, funds released
        Disputed,       // 4 - Client raised dispute
        Refunded,       // 5 - Funds returned to client
        Cancelled       // 6 - Project cancelled before acceptance
    }
    
    struct Project {
        uint256 id;
        address payable client;
        address payable freelancer;
        uint256 amount;
        uint256 createdAt;
        uint256 deadline;
        ProjectState state;
        string title;
        string description;
    }
    
    // State variables
    address public owner;
    uint256 public projectCount;
    uint256 public platformFeePercent; // Fee in basis points (100 = 1%)
    
    mapping(uint256 => Project) public projects;
    mapping(address => uint256[]) public clientProjects;
    mapping(address => uint256[]) public freelancerProjects;
    
    // Events
    event ProjectCreated(uint256 indexed projectId, address indexed client, uint256 amount, string title);
    event ProjectAccepted(uint256 indexed projectId, address indexed freelancer);
    event WorkSubmitted(uint256 indexed projectId, address indexed freelancer);
    event FundsReleased(uint256 indexed projectId, address indexed freelancer, uint256 amount);
    event FundsRefunded(uint256 indexed projectId, address indexed client, uint256 amount);
    event ProjectCancelled(uint256 indexed projectId, address indexed client);
    event DisputeRaised(uint256 indexed projectId, address indexed client);
    event DisputeResolved(uint256 indexed projectId, bool releasedToFreelancer);
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }
    
    modifier onlyClient(uint256 _projectId) {
        require(msg.sender == projects[_projectId].client, "Only client can call this");
        _;
    }
    
    modifier onlyFreelancer(uint256 _projectId) {
        require(msg.sender == projects[_projectId].freelancer, "Only freelancer can call this");
        _;
    }
    
    modifier inState(uint256 _projectId, ProjectState _state) {
        require(projects[_projectId].state == _state, "Invalid project state for this action");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        projectCount = 0;
        platformFeePercent = 250; // 2.5% platform fee
    }
    
    /**
     * @dev Client creates a project and locks funds in escrow
     * @param _title Project title
     * @param _description Project description
     * @param _deadline Project deadline (unix timestamp)
     */
    function createProject(
        string memory _title,
        string memory _description,
        uint256 _deadline
    ) external payable {
        require(msg.value > 0, "Must send ETH to create project");
        require(_deadline > block.timestamp, "Deadline must be in the future");
        require(bytes(_title).length > 0, "Title cannot be empty");
        
        projectCount++;
        
        projects[projectCount] = Project({
            id: projectCount,
            client: payable(msg.sender),
            freelancer: payable(address(0)),
            amount: msg.value,
            createdAt: block.timestamp,
            deadline: _deadline,
            state: ProjectState.Created,
            title: _title,
            description: _description
        });
        
        clientProjects[msg.sender].push(projectCount);
        
        emit ProjectCreated(projectCount, msg.sender, msg.value, _title);
    }
    
    /**
     * @dev Freelancer accepts the project
     * @param _projectId The project ID to accept
     */
    function acceptProject(uint256 _projectId) 
        external 
        inState(_projectId, ProjectState.Created) 
    {
        require(msg.sender != projects[_projectId].client, "Client cannot accept own project");
        
        projects[_projectId].freelancer = payable(msg.sender);
        projects[_projectId].state = ProjectState.Active;
        
        freelancerProjects[msg.sender].push(_projectId);
        
        emit ProjectAccepted(_projectId, msg.sender);
    }
    
    /**
     * @dev Freelancer submits completed work
     * @param _projectId The project ID
     */
    function submitWork(uint256 _projectId) 
        external 
        onlyFreelancer(_projectId) 
        inState(_projectId, ProjectState.Active) 
    {
        projects[_projectId].state = ProjectState.Submitted;
        emit WorkSubmitted(_projectId, msg.sender);
    }
    
    /**
     * @dev Client approves the work and releases funds to freelancer
     * @param _projectId The project ID
     */
    function releaseFunds(uint256 _projectId) 
        external 
        onlyClient(_projectId) 
        inState(_projectId, ProjectState.Submitted) 
    {
        Project storage project = projects[_projectId];
        
        uint256 platformFee = (project.amount * platformFeePercent) / 10000;
        uint256 freelancerPayment = project.amount - platformFee;
        
        project.state = ProjectState.Completed;
        
        // Transfer funds
        project.freelancer.transfer(freelancerPayment);
        payable(owner).transfer(platformFee);
        
        emit FundsReleased(_projectId, project.freelancer, freelancerPayment);
    }
    
    /**
     * @dev Client raises a dispute
     * @param _projectId The project ID
     */
    function raiseDispute(uint256 _projectId) 
        external 
        onlyClient(_projectId) 
        inState(_projectId, ProjectState.Submitted) 
    {
        projects[_projectId].state = ProjectState.Disputed;
        emit DisputeRaised(_projectId, msg.sender);
    }
    
    /**
     * @dev Owner (platform) resolves a dispute
     * @param _projectId The project ID
     * @param _releaseToFreelancer If true, release to freelancer; if false, refund to client
     */
    function resolveDispute(uint256 _projectId, bool _releaseToFreelancer) 
        external 
        onlyOwner 
        inState(_projectId, ProjectState.Disputed) 
    {
        Project storage project = projects[_projectId];
        
        if (_releaseToFreelancer) {
            uint256 platformFee = (project.amount * platformFeePercent) / 10000;
            uint256 freelancerPayment = project.amount - platformFee;
            
            project.state = ProjectState.Completed;
            project.freelancer.transfer(freelancerPayment);
            payable(owner).transfer(platformFee);
            
            emit FundsReleased(_projectId, project.freelancer, freelancerPayment);
        } else {
            project.state = ProjectState.Refunded;
            project.client.transfer(project.amount);
            
            emit FundsRefunded(_projectId, project.client, project.amount);
        }
        
        emit DisputeResolved(_projectId, _releaseToFreelancer);
    }
    
    /**
     * @dev Client cancels project before a freelancer accepts
     * @param _projectId The project ID
     */
    function cancelProject(uint256 _projectId) 
        external 
        onlyClient(_projectId) 
        inState(_projectId, ProjectState.Created) 
    {
        Project storage project = projects[_projectId];
        project.state = ProjectState.Cancelled;
        project.client.transfer(project.amount);
        
        emit ProjectCancelled(_projectId, msg.sender);
    }
    
    /**
     * @dev Get project details
     * @param _projectId The project ID
     */
    function getProject(uint256 _projectId) external view returns (
        uint256 id,
        address client,
        address freelancer,
        uint256 amount,
        uint256 createdAt,
        uint256 deadline,
        ProjectState state,
        string memory title,
        string memory description
    ) {
        Project memory p = projects[_projectId];
        return (p.id, p.client, p.freelancer, p.amount, p.createdAt, p.deadline, p.state, p.title, p.description);
    }
    
    /**
     * @dev Get total projects by client
     */
    function getClientProjectCount(address _client) external view returns (uint256) {
        return clientProjects[_client].length;
    }
    
    /**
     * @dev Get total projects by freelancer
     */
    function getFreelancerProjectCount(address _freelancer) external view returns (uint256) {
        return freelancerProjects[_freelancer].length;
    }
    
    /**
     * @dev Get client project IDs
     */
    function getClientProjects(address _client) external view returns (uint256[] memory) {
        return clientProjects[_client];
    }
    
    /**
     * @dev Get freelancer project IDs
     */
    function getFreelancerProjects(address _freelancer) external view returns (uint256[] memory) {
        return freelancerProjects[_freelancer];
    }
    
    /**
     * @dev Get contract balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Update platform fee (owner only)
     */
    function updatePlatformFee(uint256 _newFeePercent) external onlyOwner {
        require(_newFeePercent <= 1000, "Fee cannot exceed 10%");
        platformFeePercent = _newFeePercent;
    }
}

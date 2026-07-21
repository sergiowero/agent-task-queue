## MODIFIED Requirements

### Requirement: Board column mapping
The system SHALL map workflow statuses to board columns according to a fixed mapping.

#### Scenario: Pending column groups correct statuses
- **WHEN** tasks are grouped into the Pending column
- **THEN** tasks with status PlanRequested, Ready, Plan Changes Requested, Code Review Requested, Changes Requested, or Approved are displayed

#### Scenario: In Progress column groups correct statuses
- **WHEN** tasks are grouped into the In Progress column
- **THEN** tasks with status Planning, Coding, Reviewing, or Merging are displayed

#### Scenario: Need Review column groups correct statuses
- **WHEN** tasks are grouped into the Need Review column
- **THEN** tasks with status Waiting Plan Review or Waiting Code Review are displayed

#### Scenario: Done column groups correct statuses
- **WHEN** tasks are grouped into the Done column
- **THEN** tasks with status Complete or Merged are displayed

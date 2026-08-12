Feature: Configured advisory consultations

  Scenario: Ask the configured advisor for project skill recommendations
    Given a project is selected in the Projects tab
    When I press "c" and submit a project goal
    Then an advisory consultation panel shows progress before the configured advisor runs
    And the configured advisor receives only the bounded project skill inventory
    When the configured advisor returns valid recommendations
    Then each proposal is selectable before any project change occurs
    And accepting a selected proposal uses the existing project action

  Scenario: Recover from an interrupted project consultation
    Given an advisory consultation is running for a project
    When I press Escape
    Then the consultation is cancelled and the project state is unchanged
    And I can start another consultation

  Scenario: Compose a profile with the configured advisor
    Given I am creating or editing a profile
    When I ask the configured advisor to recommend a skill bundle
    Then it proposes a profile draft using current known skills
    And applying the proposal changes only the in-memory builder selection
    And the configuration remains unchanged until I use the existing save action

  Scenario: Explain installed plugin component state with the configured advisor
    Given an installed plugin detail shows component status
    When I consult the configured advisor about the current state
    Then the configured advisor receives only current component statuses, bounded diffs, and available action IDs
    And the configured advisor can recommend only an existing action
    When I select a recommended action
    Then Blackbook highlights that existing action without dispatching it automatically

  Scenario: Configure the consultation runtime and model
    Given I am in Settings
    When I select Claude Code, OpenCode, or Pi as the consultation runtime
    And I enter an optional model identifier
    Then Blackbook persists both settings
    And the next consultation invokes only the selected runtime with that model

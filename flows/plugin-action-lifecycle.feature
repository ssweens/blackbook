Feature: Plugin detail actions reflect live state

  Scenario: Uninstall an installed plugin from its detail view
    Given "frontend-design" is open in the Installed tab and is installed in at least one tool
    When I choose "Remove from all tools (keeps source repo)"
    Then an uninstall-in-progress message appears immediately
    And the action cannot be submitted again while uninstall is running
    When uninstall completes successfully
    Then the detail view no longer says "Installed"
    And install actions replace uninstall actions without leaving and reopening the detail view
    And the success message remains visible

  Scenario: Run any asynchronous plugin detail action
    Given a plugin detail action that performs disk or network work is selected
    When I start the action
    Then an action-specific in-progress message appears before the work begins
    And the selected action cannot run a second time while work is in progress
    When the action completes
    Then plugin list state, detail state, component status, and available actions refresh together

  Scenario: A plugin detail action fails
    Given a plugin detail action that performs disk or network work is selected
    When I start the action and it fails
    Then an action-specific in-progress message appears before the work begins
    And an error message replaces it when the failure is known
    And the detail view refreshes from durable state instead of assuming success

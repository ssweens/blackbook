Feature: Marketplace plugin discovery
  Blackbook discovers plugins from configured marketplaces.
  Each marketplace has a .claude-plugin/marketplace.json that lists
  available plugins with their source paths.

  Rule: Marketplace lists discoverable plugins

    @MP-1
    Scenario: Load plugins from valid marketplace
      Given a marketplace "playbook" with 3 plugins
      When the marketplace is loaded
      Then 3 plugins are discovered
      And each plugin has a name, description, and source path

    @MP-2
    Scenario: Plugin source path resolves correctly
      Given a marketplace plugin "crafting-interfaces" with source "./plugins/crafting-interfaces"
      When the plugin source is resolved relative to marketplace root
      Then the resolved path exists as a directory
      And the directory contains a valid plugin manifest

    @MP-3
    Scenario: Plugin with missing source directory
      Given a marketplace plugin "missing" with source "./plugins/missing"
      When the plugin source is resolved
      Then the resolved path does not exist
      And the plugin is flagged with error "source not found"

    @MP-4
    Scenario: Marketplace file is missing
      Given a marketplace configured with URL that returns 404
      When the marketplace is loaded
      Then a fetch error is returned
      And no plugins are discovered from this marketplace

    @MP-5
    Scenario: Marketplace file has malformed JSON
      Given a marketplace file with invalid JSON syntax
      When the marketplace is loaded
      Then a parse error is returned
      And no plugins are discovered

    @MP-6
    Scenario: Multiple marketplaces with overlapping plugins
      Given marketplace "alpha" lists plugin "shared-tool"
      And marketplace "beta" lists plugin "shared-tool"
      When all marketplaces are loaded
      Then the plugin "shared-tool" appears once
      And the latest version is preferred

  Rule: Marketplace can be enabled or disabled

    @MP-7
    Scenario: Disabled marketplace is not loaded
      Given marketplace "playbook" exists but is disabled
      When marketplaces are loaded
      Then "playbook" plugins are not included in results

    @MP-8
    Scenario: Toggle marketplace enabled state
      Given marketplace "playbook" is enabled
      When the user toggles "playbook" to disabled
      Then marketplace "playbook" is marked disabled
      And its plugins are excluded from next load

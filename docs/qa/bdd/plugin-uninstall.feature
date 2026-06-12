Feature: Plugin uninstallation
  Removing a plugin removes all its symlinks from tool instances.
  The plugin source remains in the marketplace cache.

  Rule: Uninstall removes all plugin artifacts

    @UNINSTALL-1
    Scenario: Uninstall plugin with single skill
      Given a plugin "eval-model" is installed to "claude-code"
      When the plugin is uninstalled from "claude-code"
      Then the skill symlink "~/.claude/skills/eval-model/eval-model" is removed
      And the plugin no longer appears in installed plugins for "claude-code"

    @UNINSTALL-2
    Scenario: Uninstall plugin with multiple skills and commands
      Given a plugin "crafting-interfaces" is installed to "claude-code"
      And the plugin has skills ["crafting-interfaces"] and commands ["verdict"]
      When the plugin is uninstalled from "claude-code"
      Then all skill symlinks are removed
      And all command symlinks are removed

    @UNINSTALL-3
    Scenario: Uninstall plugin from all tools
      Given a plugin "eval-model" is installed to "claude-code" and "codex"
      When the plugin is uninstalled from all tools
      Then the plugin is removed from "claude-code"
      And the plugin is removed from "codex"

    @UNINSTALL-4
    Scenario: Uninstall restores backed up content
      Given a plugin "my-plugin" was installed
      And during install a user file was backed up as ".bak"
      When the plugin is uninstalled
      Then the ".bak" file is restored to original path
      And the plugin symlink is removed

  Rule: Uninstall does not affect other plugins

    @UNINSTALL-5
    Scenario: Uninstall one plugin leaves others intact
      Given plugins "eval-model" and "crafting-interfaces" are installed to "claude-code"
      When "eval-model" is uninstalled from "claude-code"
      Then "crafting-interfaces" remains installed to "claude-code"
      And its symlinks are unchanged

    @UNINSTALL-6
    Scenario: Uninstall plugin that is not installed
      Given a plugin "not-installed" exists in marketplace
      When the plugin is uninstalled
      Then the operation completes without error
      And a notification indicates the plugin was not installed

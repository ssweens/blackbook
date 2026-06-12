Feature: Plugin installation
  Plugins are installed to tool instances by creating symlinks.
  Skills are namespaced: skills/<plugin-name>/<skill-name>/
  Commands go flat: commands/<command-name>.md

  Rule: Install creates namespaced skill symlinks

    @INSTALL-1
    Scenario: Install plugin with single skill
      Given a plugin "eval-model" with skill "eval-model"
      And tool "claude-code" is enabled with skillsSubdir "skills"
      When the plugin is installed to "claude-code"
      Then a symlink exists at "~/.claude/skills/eval-model/eval-model"
      And the symlink target contains "SKILL.md"

    @INSTALL-2
    Scenario: Install plugin with multiple skills
      Given a plugin "ssmp" with skills ["mixing", "mastering", "synthesis"]
      And tool "claude-code" is enabled
      When the plugin is installed to "claude-code"
      Then symlinks exist at:
        | path                          |
        | ~/.claude/skills/ssmp/mixing   |
        | ~/.claude/skills/ssmp/mastering |
        | ~/.claude/skills/ssmp/synthesis |

    @INSTALL-3
    Scenario: Install plugin with commands
      Given a plugin "crafting-interfaces" with command "verdict"
      And tool "claude-code" is enabled with commandsSubdir "commands"
      When the plugin is installed to "claude-code"
      Then a symlink exists at "~/.claude/commands/verdict.md"

    @INSTALL-4
    Scenario: Install plugin to multiple tools
      Given a plugin "eval-model" with skill "eval-model"
      And tool "claude-code" is enabled
      And tool "codex" is enabled
      When the plugin is installed to all enabled tools
      Then the plugin is installed to "claude-code"
      And the plugin is installed to "codex"

    @INSTALL-5
    Scenario: Idempotent install
      Given a plugin "eval-model" is already installed to "claude-code"
      When the plugin is installed again to "claude-code"
      Then no duplicate symlinks are created
      And the existing symlinks are unchanged

  Rule: Install handles conflicts and errors

    @INSTALL-6
    Scenario: Install backs up conflicting user content
      Given a plugin "my-plugin" with skill "my-skill"
      And user has a file at "~/.claude/skills/my-plugin/my-skill/SKILL.md"
      When the plugin is installed
      Then the user file is backed up with ".bak" extension
      And the plugin symlink is created

    @INSTALL-7
    Scenario: Install skips disabled tools
      Given a plugin "eval-model"
      And tool "claude-code" is enabled
      And tool "pi" is disabled
      When the plugin is installed to all tools
      Then the plugin is installed to "claude-code"
      And the plugin is not installed to "pi"

    @INSTALL-8
    Scenario: Install fails when source directory missing
      Given a plugin "missing" with source "./plugins/missing"
      And the source directory does not exist
      When the plugin is installed
      Then the install fails with error "source not found"
      And no symlinks are created

    @INSTALL-9 @wip
    Scenario: Install fails when target directory not writable
      Given a plugin "test-plugin"
      And the tool config directory is read-only
      When the plugin is installed
      Then the install fails with a permission error
      And partial symlinks are cleaned up

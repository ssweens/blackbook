Feature: Plugin structure validation
  Plugins must follow a specific directory structure to be installable.
  The .claude-plugin/plugin.json manifest declares the plugin's
  skills, commands, and agents. Skills are namespaced under the plugin.

  Rule: Valid plugin structure requires manifest and skills directory

    @STRUCT-1
    Scenario: Valid plugin with manifest and skill
      Given a plugin directory with ".claude-plugin/plugin.json"
      And the manifest declares name "eval-model" and skills ["eval-model"]
      And the directory contains "skills/eval-model/SKILL.md"
      When the plugin structure is validated
      Then the plugin is valid
      And the plugin has 1 skill

    @STRUCT-2
    Scenario: Plugin with multiple skills
      Given a plugin directory with ".claude-plugin/plugin.json"
      And the manifest declares skills ["skill-a", "skill-b", "skill-c"]
      And each skill has a corresponding "skills/<name>/SKILL.md"
      When the plugin structure is validated
      Then the plugin is valid
      And the plugin has 3 skills

    @STRUCT-3
    Scenario: Plugin with commands
      Given a plugin directory with ".claude-plugin/plugin.json"
      And the manifest declares commands ["verdict"]
      And the directory contains "commands/verdict.md"
      When the plugin structure is validated
      Then the plugin is valid
      And the plugin has 1 command

    @STRUCT-4
    Scenario: Plugin with agents
      Given a plugin directory with ".claude-plugin/plugin.json"
      And the manifest declares agents ["my-agent"]
      And the directory contains "agents/my-agent.md"
      When the plugin structure is validated
      Then the plugin is valid
      And the plugin has 1 agent

    @STRUCT-5
    Scenario: Plugin missing manifest file
      Given a plugin directory without ".claude-plugin/plugin.json"
      When the plugin structure is validated
      Then the plugin is invalid
      And the error is "missing manifest"

    @STRUCT-6
    Scenario: Plugin with malformed manifest JSON
      Given a plugin directory with ".claude-plugin/plugin.json" containing invalid JSON
      When the plugin structure is validated
      Then the plugin is invalid
      And the error is "invalid manifest JSON"

    @STRUCT-7
    Scenario: Plugin manifest missing required name field
      Given a plugin directory with manifest missing the "name" field
      When the plugin structure is validated
      Then the plugin is invalid
      And the error mentions missing required field "name"

    @STRUCT-8
    Scenario: Plugin declares skill but SKILL.md is missing
      Given a plugin directory with manifest declaring skill "ghost-skill"
      And the directory does not contain "skills/ghost-skill/SKILL.md"
      When the plugin structure is validated
      Then the plugin is invalid
      And the error is "skill 'ghost-skill' has no SKILL.md"

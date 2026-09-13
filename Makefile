#=============================================================================
# Makefile for Building, Packaging, and Installing GNOME Shell Extension
#
# Targets:
#   make clean       - Removes the build directory
#   make all         - Prepares the build without compiling schemas
#   make xz          - Creates a .tar.xz archive of the build (schemas not compiled)
#   make zip         - Creates a .zip archive of the build (schemas not compiled)
#   make install     - Prepares the build, compiles schemas, and installs the extension
#   make uninstall   - Uninstalls the extension from the GNOME Shell extensions directory
#
# Dependencies:
#   - Ensure 'jq' is installed for JSON parsing
#   - Ensure 'glib-compile-schemas' is available for schema compilation
#
# Usage:
#   make [target]
#
# Example:
#   make install
#=============================================================================

#=============================================================================
# Ensure jq is installed
ifneq ($(shell which jq),)
    JQ := jq
else
    $(error "jq is not installed. Please install jq to proceed.")
endif

# Extract UUID from metadata.json using jq
UUID := $(shell $(JQ) -r .uuid src/metadata.json)

# Define directories and file patterns
SRCDIR := src
BUILDDIR := build
FILES := *.json *.js schemas media

# Determine absolute paths
MKFILE_PATH := $(lastword $(MAKEFILE_LIST))
MKFILE_DIR := $(dir $(MKFILE_PATH))
ABS_MKFILE_PATH := $(abspath $(MKFILE_PATH))
ABS_MKFILE_DIR := $(abspath $(MKFILE_DIR))
ABS_BUILDDIR := $(ABS_MKFILE_DIR)/$(BUILDDIR)

# Installation path for GNOME Shell extensions
INSTALL_PATH := $(HOME)/.local/share/gnome-shell/extensions
#=============================================================================

# Declare phony targets to prevent conflicts with files of the same name
.PHONY: clean all prepare_copy compile_schemas zip xz install uninstall

# Default target
default: all

# Clean the build directory
clean:
	@rm -rf $(BUILDDIR)
	@echo "Cleaned build directory."

# Prepare the build by copying source files
prepare_copy:
	@mkdir -p $(BUILDDIR)/$(UUID)
	@cp -r $(SRCDIR)/* $(BUILDDIR)/$(UUID)
	@echo "Source files copied to $(BUILDDIR)/$(UUID)."

# Compile schemas (always run during install)
compile_schemas:
	@echo "Compiling schemas..."
	@if [ -d $(BUILDDIR)/$(UUID)/schemas ]; then \
		glib-compile-schemas $(BUILDDIR)/$(UUID)/schemas || { echo "Schema compilation failed."; exit 1; }; \
		echo "Schemas compiled successfully."; \
	else \
		echo "No schemas directory found. Skipping schema compilation."; \
	fi

# All target: prepare_copy only (schemas not compiled here)
all: prepare_copy

# Package the build into a .tar.xz archive (schemas not compiled)
xz: all
	@echo "Creating .tar.xz archive..."
	(cd $(BUILDDIR)/$(UUID); \
         tar -czvf $(ABS_BUILDDIR)/$(UUID).tar.xz $(FILES:%=%); \
        );
	@echo "Archive $(ABS_BUILDDIR)/$(UUID).tar.xz created successfully."

# Package the build into a .zip archive (schemas not compiled)
zip: all
	@echo "Creating .zip archive..."
	(cd $(BUILDDIR)/$(UUID); \
         zip -rq $(ABS_BUILDDIR)/$(UUID).zip $(FILES:%=%); \
        );
	@echo "Archive $(ABS_BUILDDIR)/$(UUID).zip created successfully."

# Install the extension to the GNOME Shell extensions directory (includes schema compilation)
install: all compile_schemas
	@mkdir -p $(INSTALL_PATH)/$(UUID)
	@cp -R -p $(BUILDDIR)/$(UUID)/* $(INSTALL_PATH)/$(UUID)
	@echo "Extension $(UUID) installed successfully to $(INSTALL_PATH)/$(UUID)."

# Uninstall the extension
uninstall:
	@rm -rf $(INSTALL_PATH)/$(UUID)
	@echo "Extension $(UUID) uninstalled successfully from $(INSTALL_PATH)/$(UUID)."

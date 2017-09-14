AFRAME.registerComponent('three-ar-planes', {
  dependencies: ['three-ar'],

  init: function () {
    // Remember planes when we see them.
    this.planes = {};
    this.anchorsAdded = [];
    this.anchorsAddedDetail = {type:'Added', anchors: this.anchorsAdded};
    this.anchorsUpdated = [];
    this.anchorsUpdatedDetail = {type:'Updated', anchors: this.anchorsUpdated};
    this.anchorsRemoved = [];
    this.anchorsRemovedDetail = {type:'Removed', anchors: this.anchorsRemoved};
  },

  tick: (function (t, dt) {
    // Create the temporary variables we will reuse, if needed.
    var tempAlignment = 0;
    var tempScale = new THREE.Vector3(1, 1, 1);
    var tempExtent3 = new THREE.Vector3();
    var tempMat4 = new THREE.Matrix4();
    var tempPosition = new THREE.Vector3();
    var tempRotation = new THREE.Vector3();
    var tempQuaternion = new THREE.Quaternion();
    var tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    // The actual function, which we return.
    return function (t, dt) {
      // Check to see if the anchor list is available.
      var threear = this.el.components['three-ar'];
      if (!threear || !threear.arDisplay) { return; }
      var arDisplay = threear.arDisplay;

      // Get the list of planes.
      var planes = arDisplay.getPlanes ? arDisplay.getPlanes() : arDisplay.anchors_;

      // Ideally we would have either events, or separate lists for added / updated / removed.
      var addedThese = [];
      var updatedThese = [];
      var removedThese = [];

      // Because we don't have an indication of added / updated / removed,
      // try to keep track ourselves.
      var seenThese = {};
      var i;

      // Iterate over the available planes.
      for (i=0; planes && i<planes.length; i++) {
        var plane = planes[i];

        // Force plane conformance to latest spec.
        // (Hopefully soon, this will no longer be required.)
        var planespec = {};
        // Get plane identifier and conform.
        planespec.identifier = (plane.identifier !== undefined ? plane.identifier : plane.id).toString();
        // Copy plane timestamp, if available.
        if (plane.timestamp) { planespec.timestamp = plane.timestamp; }
	// Make the position, orientation and extent data conform.
        if (plane.transform) {
          // ARKit exposes transform, not position and orientation.
          // We don't have change timestamps, so planespec needs to be JSON stringify/parse cloneable.
          tempMat4.fromArray(plane.transform);
          tempMat4.decompose(tempPosition, tempQuaternion, tempScale);
          planespec.position = [tempPosition.x, tempPosition.y, tempPosition.z];
          planespec.orientation = [tempQuaternion._x, tempQuaternion._y, tempQuaternion._z, tempQuaternion._w];
          planespec.extent = plane.extent;
        } else {
          // Draft ARCore exposes typed arrays, which JSON stringify/parse hates.
          // (However, if we can rely on timestamps for update check, we don't need to worry about that.)
          if (planespec.timestamp !== undefined) {
            planespec.position = plane.position;
            planespec.orientation = plane.orientation;
            planespec.extent = plane.extent;
            if (plane.polygon) { planespec.vertices = plane.polygon; } 
            else if (plane.vertices) { planespec.vertices = plane.vertices; }
          } else {
            // Make planespec stringify/parse clone friendly.
            planespec.position = [plane.position['0'], plane.position['1'], plane.position['2']];
            planespec.orientation = [plane.orientation['0'], plane.orientation['1'], plane.orientation['2'], plane.orientation['3']];
            planespec.extent = [plane.extent['0'], plane.extent['1']];
            if (plane.polygon) {
              planespec.vertices = [];
              plane.polygon.forEach(function (n) { planespec.vertices.push(n); });
            } else if (plane.vertices) { planespec.vertices = plane.vertices; }
          }
        }

        // Note that we've seen it.
	var id = planespec.identifier;
        seenThese[id] = true;
        // Figure out whether added or updated.
        if (this.planes[id]) {
          // If we've seen it before, and we have timestamp values, just check those
          if (this.planes[id].timestamp) {
            if (planespec.timestamp !== this.planes[id].timestamp) {
              updatedThese.push(planespec);
            }
	  } else
          // If we've seen it before, we should have it cached in this.planes already, to compare against.
          if (!AFRAME.utils.deepEqual(planespec, this.planes[id])) {
            updatedThese.push(planespec);
          }
        } else {
          // Remember by cloning the plane into this.planes.
          // If there is a timestamp to check, we don't need to stringify/parse clone for AFRAME.utils.deepEqual.
          this.planes[id] = planespec.timestamp !== undefined ? planespec : JSON.parse(JSON.stringify(planespec));
          addedThese.push(planespec);
        }
      }

      // To find ones we've removed, we need to scan this.planes.
      var self = this;
      Object.keys(self.planes).forEach(function (key) {
        if (!seenThese[key]) {
          removedThese.push(self.planes[key]);
          delete self.planes[key];
        }
      });

      // OK, now we should have separate added / updated / removed lists,
      // with planes that match spec,
      // from which we can emit appropriate events downstream.

      // Replace the old list.
      this.anchorsAdded = addedThese;
      // Emit event if list isn't empty.
      if (addedThese.length > 0) {
        // Reuse the same event detail to avoid making garbage.
        // TODO: Reuse same CustomEvent?
        this.anchorsAddedDetail.anchors = addedThese;
        this.el.emit('anchorsAdded', this.anchorsAddedDetail);
      }

      // Replace the old list.
      this.anchorsUpdated = updatedThese;
      // Emit event if list isn't empty.
      if (updatedThese.length > 0) {
        // Reuse the same event detail to avoid making garbage.
        // TODO: Reuse same CustomEvent?
        this.anchorsUpdatedDetail.anchors = updatedThese;
        this.el.emit('anchorsUpdated', this.anchorsUpdatedDetail);
      }

      // Replace the old list.
      this.anchorsRemoved = removedThese;
      // Emit event if list isn't empty.
      if (removedThese.length > 0) {
        // Reuse the same event detail to avoid making garbage.
        // TODO: Reuse same CustomEvent?
        this.anchorsRemovedDetail.anchors = removedThese;
        this.el.emit('anchorsRemoved', this.anchorsRemovedDetail);
      }
/*
      // First, emit remove events as appropriate.
      removedThese.forEach(function (plane) {
        self.el.emit('removeplane', {id: plane.identifier});
      });

      // Next, emit updated events as appropriate.
      updatedThese.forEach(function (plane) {
	// Per spec, we get:
        // identifier (as string),
        // position (as number[3]),
        // orientation (as number[4]),
        // extent (as number[2]),
        // and possible vertices (as number[3*n]

        // For now, convert to legacy format.
        tempPosition.fromArray(plane.position);
        tempQuaternion.fromArray(plane.orientation);
        tempEuler.setFromQuaternion(tempQuaternion);
        tempRotation.set(
          tempEuler.x * THREE.Math.RAD2DEG,
          tempEuler.y * THREE.Math.RAD2DEG,
          tempEuler.z * THREE.Math.RAD2DEG);
        tempExtent3.set(plane.extent[0], 0, plane.extent[1]);

        self.el.emit('updateplane', {
          id: plane.identifier,
          alignment: tempAlignment,
          position: tempPosition,
          rotation: tempRotation,
          extent: tempExtent3,
          vertices: plane.vertices,
          scale: tempScale});
      });

      // Last, emit added/created events as appropriate.
      addedThese.forEach(function (plane) {
	// Per spec, we get:
        // identifier (as string),
        // position (as number[3]),
        // orientation (as number[4]),
        // extent (as number[2]),
        // and possible vertices (as number[3*n]

        // For now, convert to legacy format.
        tempPosition.fromArray(plane.position);
        tempQuaternion.fromArray(plane.orientation);
        tempEuler.setFromQuaternion(tempQuaternion);
        tempRotation.set(
          tempEuler.x * THREE.Math.RAD2DEG,
          tempEuler.y * THREE.Math.RAD2DEG,
          tempEuler.z * THREE.Math.RAD2DEG);
        tempExtent3.set(plane.extent[0], 0, plane.extent[1]);

        self.el.emit('createplane', {
          id: plane.identifier,
          alignment: tempAlignment,
          position: tempPosition,
          rotation: tempRotation,
          extent: tempExtent3,
          vertices: plane.vertices || plane.polygon,
          scale: tempScale});
      });
*/
    };    
  })()
});